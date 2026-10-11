// Задачи на сегодня, текущая задача и таймер фокуса в рабочем окне.
import * as repo from '../core/repo.js';
import * as Tasks from '../core/tasks.js';
import * as Timer from '../core/timer.js';
import * as A from './actions.js';
import { listen } from '../core/bridge.js';
import { h, $, toast } from '../ui/dom.js';
import { fmtDuration, dayKey, hm, plural } from '../core/time.js';

let tasks, state, settings, onBreakdown;

export async function initWork({ breakdown }) {
  onBreakdown = breakdown;
  await reload();
  $('#addTask').addEventListener('submit', async (e) => {
    e.preventDefault(); const v = $('#taskInput').value.trim(); if (!v) return;
    await A.addTask(v); $('#taskInput').value = ''; await reload();
  });
  $('#timerMain').onclick = async () => { state.timer = await A.timer(state.timer.phase === 'idle' ? 'start' : 'pause'); renderTimer(); };
  $('#timerBreak').onclick = async () => { state.timer = await A.timer('break'); renderTimer(); };
  $('#timerStop').onclick = async () => { state.timer = await A.timer('stop'); renderTimer(); };
  listen('store-changed', (e) => { if (['tasks', 'state', 'settings'].includes(e.payload.name)) reload(); });
  setInterval(() => { if (!document.hidden) renderTimer(); }, 1000);
}

export async function reload() {
  [tasks, state, settings] = await Promise.all([repo.get('tasks'), repo.get('state'), repo.get('settings')]);
  renderTasks(); renderTimer(); renderReminders();
}

function renderTasks() {
  const list = Tasks.today(tasks);
  const open = list.filter((t) => !t.done).length;
  $('#taskCount').textContent = list.length ? `${list.length - open} из ${list.length}` : '';
  const ul = $('#taskList'); ul.replaceChildren();
  if (!list.length) ul.append(h('li.task-empty', {}, 'Пока пусто. Начни с маленькой задачи.'));
  // родительские задачи, затем их шаги
  const roots = list.filter((t) => !t.parentId || !list.some((p) => p.id === t.parentId));
  const ordered = [];
  for (const r of roots.sort((a, b) => a.done - b.done)) { ordered.push(r); ordered.push(...list.filter((t) => t.parentId === r.id)); }
  for (const t of ordered) ul.append(taskRow(t));
  // текущая задача
  const cur = tasks.items.find((t) => t.id === tasks.currentId && !t.done);
  const box = $('#currentTask'); box.replaceChildren();
  if (cur) {
    box.append(h('input.check', { type: 'checkbox', title: 'Выполнено', onchange: () => done(cur.id) }), h('b', { title: cur.title }, cur.title));
  } else {
    box.append(h('span.none', {}, 'Текущая задача не выбрана'));
  }
}

function iconBtn(title, d, onclick) {
  const b = h('button', { title, 'aria-label': title, onclick });
  b.innerHTML = `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  return b;
}

function taskRow(t) {
  const isOld = !t.done && t.day < dayKey();
  const li = h('li.task', { class: (t.done ? 'done ' : '') + (t.parentId ? 'sub ' : '') + (t.id === tasks.currentId ? 'current' : '') },
    h('input.check', { type: 'checkbox', checked: t.done, 'aria-label': 'Выполнено: ' + t.title, onchange: () => done(t.id) }),
    h('span.t-title', { title: 'Двойной щелчок — переименовать', ondblclick: (e) => editTitle(e.target, t) }, t.title),
    isOld && h('span.t-old', { title: 'Перенесена с прошлых дней' }, '↻'),
    h('span.t-acts', {},
      !t.done && iconBtn('Сделать текущей', 'M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', () => setCurrent(t.id)),
      !t.done && !t.parentId && iconBtn('Разбить на шаги (ИИ)', 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', () => onBreakdown(t)),
      iconBtn('Удалить', 'M18 6L6 18M6 6l12 12', () => del(t))));
  return li;
}

async function done(id) { await A.completeTask(id); await reload(); }
async function setCurrent(id) { await repo.update('tasks', (s) => Tasks.setCurrent(s, id)); await reload(); }
async function del(t) {
  const backup = await repo.get('tasks');
  await repo.update('tasks', (s) => Tasks.remove(s, t.id)); await reload();
  toast(`Задача «${t.title}» удалена`, { label: 'Вернуть', run: async () => { await repo.put('tasks', backup); reload(); } });
}
function editTitle(el, t) {
  const input = h('input.input', { value: t.title, style: 'min-height:28px;padding:3px 6px' });
  el.replaceWith(input); input.focus(); input.select();
  const finish = async (ok) => { if (ok && input.value.trim()) await repo.update('tasks', (s) => Tasks.rename(s, t.id, input.value)); reload(); };
  input.onkeydown = (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  input.onblur = () => finish(true);
}

function renderTimer() {
  if (!state) return;
  const t = state.timer, cfg = settings.timer;
  const total = t.phase === 'idle' ? cfg.focus * 60000 : Timer.phaseLength(cfg, t.phase);
  const left = t.phase === 'idle' ? total : Timer.left(t);
  $('#timerDigits').textContent = fmtDuration(left);
  $('#timerBar').style.width = (t.phase === 'idle' ? 0 : Math.min(100, 100 * (1 - left / total))) + '%';
  $('#timerPhase').textContent = { idle: 'Фокус · ' + cfg.focus + ' мин', focus: 'Фокус', short: 'Перерыв', long: 'Длинный перерыв' }[t.phase] + (t.phase !== 'idle' && !t.running ? ' · пауза' : '');
  $('.timer').classList.toggle('break', t.phase === 'short' || t.phase === 'long');
  $('#timerMain').classList.toggle('running', !!t.running);
  $('#timerMain').setAttribute('aria-label', t.phase === 'idle' ? 'Старт' : t.running ? 'Пауза' : 'Продолжить');
  const n = state.stats[dayKey()]?.focus || 0;
  $('#focusCount').textContent = n ? `${n} ${plural(n, 'сеанс', 'сеанса', 'сеансов')} сегодня` : '';
}

function renderReminders() {
  const box = $('#customReminders'); box.replaceChildren();
  const list = (state.sched.custom || []).filter((c) => !c.done).sort((a, b) => a.at - b.at);
  if (!list.length) return;
  box.append(h('div.sec-head', {}, h('span', {}, 'Напоминания')));
  for (const c of list) box.append(h('div.rem', {}, h('time', {}, (dayKey(c.at) === dayKey() ? '' : new Date(c.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' ') + hm(c.at)), h('span', {}, c.text),
    h('button', { title: 'Удалить напоминание', onclick: async () => { await A.removeReminder(c.id); reload(); } }, '×')));
}
