// Чат с маскотом: сначала команды приложения (работают без ИИ), затем локальная модель.
import * as repo from '../core/repo.js';
import * as Tasks from '../core/tasks.js';
import * as I from '../core/intents.js';
import * as L from '../core/llm.js';
import * as A from './actions.js';
import { llm } from './llmctl.js';
import { chatStream, emit } from '../core/bridge.js';
import { say } from '../core/phrases.js';
import { h, $ } from '../ui/dom.js';
import { hm } from '../core/time.js';

let history = [];            // [{role, content, at, ok}]
let generating = null;       // {cancel}
let openSettings;

export async function initChat({ gotoSettings }) {
  openSettings = gotoSettings;
  const s = await repo.get('settings');
  history = s.chat.saveHistory ? (await repo.get('chat')).messages : [];
  render();
  const input = $('#chatInput');
  $('#composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; });
  $('#stopBtn').onclick = () => generating && generating.cancel();
  $('#chatClear').onclick = clearHistory;
  for (const b of document.querySelectorAll('.hint')) b.onclick = () => { input.value = b.textContent; send(); };
  llm.onChange((_, ev) => {
    if (ev && ev.state === 'stopped' && ev.reason === 'idle') appMsg(`Модель выгружена из памяти после ${ev.minutes || ''} мин простоя, чтобы не занимать оперативную память. Следующий ответ может потребовать дополнительного времени на загрузку.`);
  });
}

async function persist() {
  const s = await repo.get('settings'); if (!s.chat.saveHistory) return;
  await repo.put('chat', { messages: history.slice(-200) });
}
export async function clearHistory() {
  history = []; await repo.put('chat', { messages: [] }); render();
}

// ---------- отрисовка ----------
function msgEl(m) {
  let el;
  if (m.role === 'assistant') {
    const tx = h('div.tx', {}, m.content);
    if (m.note) tx.append(h('span.note', {}, m.note));
    el = h('div.msg.assistant', {}, h('img.av', { src: 'assets/mascot-full.png', alt: '' }), tx);
  } else {
    el = h('div.msg', { class: m.role + (m.ok ? ' ok' : '') }, m.content);
    if (m.note) el.append(h('span.note', {}, m.note));
  }
  if (m.at) el.title = hm(m.at);
  return el;
}
function render() {
  const log = $('#chatLog'); log.replaceChildren();
  if (!history.length) log.append(h('div.empty-chat', {}, h('img', { src: 'assets/mascot-full.png', alt: '' }), h('h1', {}, 'Чем займёмся сегодня?'), h('p', {}, 'Могу поболтать, помочь начать, разбить задачу на шаги и поставить напоминание. Задачи, таймер и напоминания работают даже без ИИ.')));
  for (const m of history) log.append(msgEl(m));
  $('#chatHints').hidden = history.length > 2;
  scroll();
}
const scroll = () => { const l = $('#chatScroll'); l.scrollTop = l.scrollHeight; };
function push(m) {
  if (!history.length) $('#chatLog').replaceChildren();
  m.at = Date.now(); history.push(m); const el = msgEl(m); $('#chatLog').append(el); scroll(); persist();
  $('#chatHints').hidden = history.length > 2; return el;
}
const appMsg = (content, ok = false) => push({ role: 'app', content, ok });

// карточка действия, которое пользователь должен подтвердить
function actionCard(action) {
  const titles = { addTask: 'Добавить задачу?', addSteps: 'Добавить шаги?', reminder: 'Поставить напоминание?', remember: 'Запомнить?' };
  let body;
  if (action.type === 'addTask') body = action.title;
  else if (action.type === 'addSteps') body = h('ol', {}, action.steps.map((s) => h('li', {}, s)));
  else if (action.type === 'reminder') body = `${action.text} — ${new Date(action.at).toDateString() === new Date().toDateString() ? 'сегодня' : 'завтра'} в ${hm(action.at)}`;
  else body = action.fact;
  const status = h('span.muted', {});
  const yes = h('button.btn.primary.small', {}, 'Подтвердить');
  const no = h('button.btn.small', {}, 'Отмена');
  const card = h('div.action-card', {}, h('div.ac-head', {}, titles[action.type] || 'Действие'), h('div.ac-body', {}, body), h('div.ac-btns', {}, yes, no, status));
  yes.onclick = async () => {
    yes.disabled = no.disabled = true; status.textContent = 'Сохраняю…';
    try {
      const r = await run(action);
      card.classList.add('done'); card.querySelector('.ac-head').textContent = '✓ Сохранено'; status.textContent = ''; yes.remove(); no.remove();
      appMsg(r.text, true);
    } catch (e) { status.textContent = 'Не удалось сохранить: ' + e.message; yes.disabled = no.disabled = false; }
  };
  no.onclick = () => { card.classList.add('cancelled'); card.querySelector('.ac-head').textContent = 'Отменено'; yes.remove(); no.remove(); };
  $('#chatLog').append(card); scroll();
  return card;
}
function run(a) {
  if (a.type === 'addTask') return A.addTask(a.title);
  if (a.type === 'addSteps') return A.addSteps(a.steps, a.parent);
  if (a.type === 'reminder') return A.reminder(a.at, a.text);
  if (a.type === 'remember') return A.remember(a.fact);
}

// ---------- отправка ----------
export async function send(text) {
  const input = $('#chatInput');
  text = (text ?? input.value).trim(); if (!text || generating) return;
  input.value = ''; input.style.height = '';
  push({ role: 'user', content: text });
  const intent = I.parse(text);
  if (intent && !intent.passToLLM) return handleIntent(intent, text);
  return askLLM(text);
}

async function handleIntent(it, text) {
  try {
    switch (it.type) {
      case 'reminder': { const r = await A.reminder(it.at, it.text); appMsg(r.text, true); emit('mascot-play', { anim: 'greet' }); return; }
      case 'reminderNeedsTime': return appMsg('Когда напомнить? Например: «напомни через 20 минут …» или «напомни в 15:30 …».');
      case 'addTask': { const r = await A.addTask(it.title); appMsg(r.text, true); return; }
      case 'completeTask': {
        const t = Tasks.find(await repo.get('tasks'), it.query);
        if (!t) return appMsg('Не нашёл такую задачу в списке на сегодня. Отметь её галочкой справа.');
        if (t.done) return appMsg(`«${t.title}» уже отмечена выполненной.`);
        await A.completeTask(t.id); return appMsg(`Отметил выполненной: «${t.title}». ${say('praiseTask')}`, true);
      }
      case 'breakdown': return breakdown({ title: it.title });
      case 'timerStart': { const t = await A.timer('start', it.minutes); appMsg(`Таймер фокуса запущен на ${Math.round((t.endsAt - Date.now()) / 60000)} мин. ${say('focusStart')}`, true); return; }
      case 'timerPause': { const t = await A.timer('pause'); appMsg(t.running ? 'Таймер продолжен.' : 'Таймер на паузе.', true); return; }
      case 'timerStop': await A.timer('stop'); return appMsg('Таймер остановлен.', true);
      case 'timerBreak': await A.timer('break'); emit('mascot-play', { anim: 'break', duration: 6000 }); return appMsg('Перерыв начался. Потянись!', true);
      case 'dndOn': { const r = await A.setDnd(it.ms); appMsg(r.text, true); return; }
      case 'dndOff': { const r = await A.dndOff(); appMsg(r.text, true); return; }
      case 'remember': { const r = await A.remember(it.fact); appMsg(r.text, true); return; }
      case 'dance': emit('mascot-play', { anim: 'dance', duration: 6000, text: say('dance') }); return appMsg('Танцую на рабочем столе — посмотри на меня!');
      case 'silly': emit('mascot-play', { anim: 'silly', text: say('silly') }); return appMsg('Смотри на рабочий стол!');
    }
  } catch (e) { appMsg('Не получилось: ' + e.message); }
}

// ---------- языковая модель ----------
async function ensureModel() {
  await llm.refresh();
  const m = await llm.active();
  if (!m) {
    const el = push({ role: 'app', content: 'Чтобы свободно болтать, нужна локальная модель ИИ (скачивается один раз, дальше работает без интернета). Команды про задачи, таймер и напоминания работают и без неё.' });
    el.append(' ', h('button.btn.small.blue', { onclick: () => openSettings('s-model') }, 'Выбрать модель'));
    return null;
  }
  try { return await llm.ensure((info) => appMsg(info)); }
  catch (e) { appMsg('Модель не запустилась: ' + e + '. Попробуй в настройках включить режим «Только процессор» или выбрать модель полегче.'); return null; }
}

async function stream(body, onText) {
  emit('llm-busy', { busy: true });
  $('#sendBtn').hidden = true; $('#stopBtn').hidden = false;
  const tx = h('div.tx'); const bubble = h('div.msg.assistant', {}, h('img.av', { src: 'assets/mascot-full.png', alt: '' }), tx); const cursor = h('span.cursor');
  if (!history.length) $('#chatLog').replaceChildren();
  $('#chatLog').append(bubble); tx.append(cursor); scroll();
  let raw = '';
  generating = chatStream(body, (d) => { raw += d; const view = L.extractActions(raw).text; tx.textContent = view; tx.append(cursor); scroll(); });
  let reason;
  try { reason = await generating.done; }
  catch (e) { reason = 'error'; tx.textContent = 'Ошибка модели: ' + e.message; }
  finally { generating = null; cursor.remove(); $('#sendBtn').hidden = false; $('#stopBtn').hidden = true; emit('llm-busy', { busy: false }); }
  return { raw, reason, bubble };
}

async function askLLM(text) {
  const m = await ensureModel(); if (!m) return;
  const [settings, tasks, memory] = await Promise.all([repo.get('settings'), repo.get('tasks'), repo.get('memory')]);
  const today = Tasks.today(tasks);
  const system = L.systemPrompt({ name: settings.userName, facts: memory.facts, tasks: today, current: tasks.items.find((t) => t.id === tasks.currentId) });
  const prior = history.slice(0, -1).filter((x) => x.role !== 'app');
  let { raw, reason, bubble } = await stream(L.buildRequest({ system, history: prior, user: text }), null);
  if (reason === 'error') { bubble.remove(); appMsg('Модель не ответила. Попробуй ещё раз.'); return; }
  if (L.looksBroken(raw) && settings.model.accel !== 'cpu') {
    // видеоускорение выдаёт мусор — переключаемся на процессор и повторяем один раз
    bubble.remove();
    appMsg('Похоже, видеоускорение на этом компьютере работает неправильно. Переключаюсь на процессор — ответы станут немного медленнее (изменить можно в настройках).');
    await repo.update('settings', (s) => { s.model.accel = 'cpu'; return s; });
    await llm.unload();
    if (!(await ensureModel())) return;
    ({ raw, reason, bubble } = await stream(L.buildRequest({ system, history: prior, user: text }), null));
    if (reason === 'error') { bubble.remove(); appMsg('Модель не ответила. Попробуй ещё раз.'); return; }
  }
  const { text: clean, actions } = L.extractActions(raw);
  const guard = L.guardClaims(clean, actions.length > 0);
  let content = guard.text || (actions.length ? 'Вот что предлагаю:' : '…');
  if (reason === 'cancelled') content += ' [остановлено]';
  bubble.remove();
  push({ role: 'assistant', content, note: guard.flagged && !actions.length ? 'Ничего не сохранено. Чтобы поставить напоминание, напиши: «напомни в 15:00 …».' : undefined });
  for (const a of actions) actionCard(a);
}

// «Разбить на шаги» — из списка задач или командой в чате
export async function breakdown(task) {
  const m = await ensureModel(); if (!m) return;
  if (history[history.length - 1]?.content !== `Разбей на шаги: ${task.title}`) push({ role: 'user', content: `Разбей на шаги: ${task.title}` });
  const { raw, reason, bubble } = await stream(L.breakdownRequest(task.title));
  bubble.remove();
  const steps = L.parseSteps(raw);
  if (reason === 'error' || !steps.length) { push({ role: 'assistant', content: raw.trim() || 'Не получилось разбить задачу. Попробуй сформулировать её подробнее.' }); return; }
  push({ role: 'assistant', content: `Предлагаю такие шаги для «${task.title}»:` });
  actionCard({ type: 'addSteps', steps, parent: task.title });
}
