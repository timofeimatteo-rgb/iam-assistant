// Компактный режим: маскот на рабочем столе + «мозг» приложения:
// таймер, напоминания, реакции. Работает без языковой модели.
import { invoke, listen, emit, currentWindow, isTauri } from './core/bridge.js';
import * as repo from './core/repo.js';
import * as Timer from './core/timer.js';
import * as Sched from './core/scheduler.js';
import * as Tasks from './core/tasks.js';
import { say } from './core/phrases.js';
import { REMINDER_INFO } from './core/defaults.js';
import { MIN, HOUR, dayKey, fmtDuration, dndActive, inWorkHours, hm } from './core/time.js';
import { Sprite } from './ui/sprite.js';

const $ = (s) => document.querySelector(s);
const sprite = new Sprite($('#sprite'));
let settings, timerCache = null, llmBusy = false, bubbleTimer = null, currentFire = null, lastDnd = false, panelPinned = false;

// ---------------- реплики ----------------
function bubble(text, { title = '', actions = [], ttl = 9000, important = false } = {}) {
  if (!important && (!settings.messagesEnabled || settings.initiative === 0)) return false;
  $('#bubbleTitle').textContent = title; $('#bubble').classList.toggle('has-title', !!title);
  $('#bubbleText').textContent = text;
  const acts = $('#bubbleActs'); acts.replaceChildren();
  for (const a of actions) {
    const b = document.createElement('button'); b.className = 'btn' + (a.primary ? ' primary' : ''); b.textContent = a.label;
    b.onclick = (e) => { e.stopPropagation(); a.run(); };
    acts.append(b);
  }
  acts.hidden = !actions.length;
  $('#bubble').hidden = false; relayout();
  clearTimeout(bubbleTimer);
  if (ttl) bubbleTimer = setTimeout(hideBubble, ttl);
  if (settings.sound && important) beep();
  return true;
}
function hideBubble() {
  $('#bubble').hidden = true; relayout();
  if (currentFire) { respond('skip'); }
}
$('#bubbleClose').onclick = hideBubble;

function beep() {
  try { const c = new AudioContext(); const o = c.createOscillator(); const g = c.createGain(); o.frequency.value = 880; g.gain.value = 0.04; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.12); } catch {}
}

// ---------------- размер окна ----------------
let lastSize = '';
function relayout() {
  requestAnimationFrame(() => {
    const r = $('#root'); const w = Math.ceil(r.offsetWidth), h = Math.ceil(r.offsetHeight);
    const key = w + 'x' + h; if (key === lastSize) return; lastSize = key;
    invoke('mascot_resize', { width: w, height: h });
  });
}

// ---------------- взаимодействие ----------------
// Перетаскивание: начинаем, если мышь сдвинулась больше чем на 4 px; иначе это клик.
let down = null;
$('#sprite').addEventListener('pointerdown', (e) => { if (e.button === 0) down = { x: e.screenX, y: e.screenY, t: Date.now() }; });
window.addEventListener('pointermove', (e) => {
  if (!down) return;
  if (Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 4) { down = null; currentWindow()?.startDragging(); }
});
window.addEventListener('pointerup', () => { if (down) { down = null; onMascotClick(); } });
$('#sprite').addEventListener('dblclick', () => invoke('open_main', { tab: 'chat' }));

let clicks = [];
function onMascotClick() {
  const now = Date.now(); clicks = clicks.filter((t) => now - t < 4000); clicks.push(now);
  if (clicks.length >= 4) { clicks = []; sprite.play('silly'); bubble(say('silly'), { ttl: 4000 }); return; }
  const r = Math.random();
  if (r < 0.45) sprite.play('greet'); else if (r < 0.75) sprite.play('joy'); else sprite.play('silly');
  bubble(say('click'), { ttl: 2500 });
  showPanel(true);
}

// панель: появляется при наведении, прячется через 2 с после ухода курсора
let panelHide = null;
function showPanel(v) {
  clearTimeout(panelHide);
  if (v) { if ($('#panel').hidden) { $('#panel').hidden = false; relayout(); } }
  else if (!panelPinned) panelHide = setTimeout(() => { $('#panel').hidden = true; relayout(); }, 2000);
}
$('#root').addEventListener('pointerenter', () => showPanel(true));
$('#root').addEventListener('pointerleave', () => showPanel(false));

$('#panel').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'chat') invoke('open_main', { tab: 'chat' });
  if (act === 'settings') invoke('open_main', { tab: 'settings' });
  if (act === 'timer') toggleTimer();
  if (act === 'dance') { sprite.play('dance', { duration: 6000 }); bubble(say('dance'), { ttl: 3000 }); }
  if (act === 'cheer') { sprite.play('joy'); bubble(say('cheer'), { ttl: 6000, important: true }); }
  if (act === 'dnd') toggleDnd();
  if (act === 'hide') {
    invoke('mascot_set_visible', { visible: false });
    invoke('notify', { title: 'I AM · маскот спрятался', body: navigator.platform.startsWith('Mac')
      ? 'Вернуть: значок кота в строке меню вверху справа или щелчок по I AM в Dock.'
      : 'Вернуть: значок I AM в трее справа внизу (стрелка ^) или снова запустите I AM.' });
  }
});

async function toggleDnd(ms = HOUR) {
  settings = await repo.update('settings', (s) => { s.dnd = { until: dndActive(s) ? 0 : Date.now() + ms }; return s; });
  syncDnd(true);
}
function syncDnd(announce) {
  const on = dndActive(settings);
  $('#panel [data-act="dnd"]').setAttribute('aria-pressed', on);
  $('#dndBadge').hidden = !on;
  if (announce) bubble(on ? say('dndOn') : say('dndOff'), { ttl: 3500, important: true });
  lastDnd = on;
}

async function toggleTimer() {
  const st = await repo.update('state', (s) => {
    const t = s.timer;
    if (t.phase === 'idle') s.timer = Timer.start(t, settings.timer, 'focus');
    else s.timer = t.running ? Timer.pause(t) : Timer.resume(t);
    return s;
  });
  if (st.timer.running && st.timer.phase === 'focus') bubble(say('focusStart'), { ttl: 3500 });
  renderTimer(st.timer); updateLoop(st.timer);
}

// ---------------- состояние маскота ----------------
function updateLoop(t) {
  let s = 'idle';
  if (llmBusy) s = 'think';
  else if (t && t.phase === 'focus' && t.running) s = 'focus';
  sprite.setLoop(s);
  $('#panel [data-act="timer"]').setAttribute('aria-pressed', !!(t && t.running));
}
function renderTimer(t) {
  timerCache = t;
  const chip = $('#chip');
  if (!t || t.phase === 'idle') { chip.hidden = true; return; }
  chip.hidden = false;
  chip.className = (t.phase === 'focus' ? '' : 'break') + (t.running ? '' : ' paused');
  chip.textContent = (t.phase === 'focus' ? '' : 'ОТДЫХ ') + fmtDuration(Timer.left(t)) + (t.running ? '' : ' ❚❚');
}

// ---------------- напоминания ----------------
async function respond(action) {
  const f = currentFire; currentFire = null; if (!f) return;
  if (action === 'disable' && f.kind === 'periodic') {
    settings = await repo.update('settings', (s) => { s.reminders[f.key].enabled = false; return s; });
  }
  await repo.update('state', (s) => { s.sched = Sched.respond(s.sched, settings, f, action === 'disable' ? 'skip' : action); return s; });
  $('#bubble').hidden = true; relayout();
  if (action === 'done') { sprite.play('joy'); setTimeout(() => bubble('Спасибо! Так держать.', { ttl: 2500 }), 50); }
  sprite.setLoop(sprite.loopState);
}

async function showReminder(fire) {
  currentFire = fire;
  const actions = [
    { label: 'Сделано', primary: true, run: () => respond('done') },
    { label: '+10 мин', run: () => respond('snooze') },
    { label: 'Пропустить', run: () => respond('skip') },
  ];
  let title, text, anim;
  if (fire.kind === 'periodic') {
    const info = REMINDER_INFO[fire.key]; title = info.title; text = info.text; anim = info.anim;
    actions.push({ label: 'Отключить', run: () => respond('disable') });
  } else {
    title = 'Напоминание'; text = fire.text + (fire.late ? ` (было на ${hm(fire.at)}, отложено из-за «Не беспокоить»)` : ''); anim = 'greet';
  }
  sprite.play(anim, { duration: anim === 'exercise' || anim === 'break' ? 8000 : undefined });
  bubble(text, { title, actions, ttl: 120000, important: true });
  // если маскот скрыт или окно не на экране — системное уведомление
  const visible = !document.hidden && settings.mascotVisible;
  if (!visible) invoke('notify', { title: 'I AM · ' + title, body: text });
}

// ---------------- главный цикл ----------------
async function tick() {
  const now = Date.now();
  // «Не беспокоить» закончился
  if (lastDnd && !dndActive(settings, now)) syncDnd(true);
  let event = null, fire = null, poke = null;
  const st = await repo.update('state', (s) => {
    const r = Timer.tick(s.timer, settings.timer, now); s.timer = r.timer; event = r.event;
    if (event && event.type === 'focusDone') {
      const k = dayKey(now); s.stats[k] = s.stats[k] || { focus: 0, tasks: 0 }; s.stats[k].focus++;
    }
    if (!currentFire) {
      const f = Sched.tick(s.sched, settings, { focusRunning: s.timer.phase === 'focus' && s.timer.running }, now);
      s.sched = f.sched; fire = f.fire;
    }
    // спонтанные реплики по уровню инициативности
    const every = [0, 150, 75, 40][settings.initiative] * MIN;
    const calm = !dndActive(settings, now) && inWorkHours(settings.workHours, now) && !(s.timer.running && s.timer.phase === 'focus');
    if (!fire && !event && every && settings.messagesEnabled && calm && now - (s.sched.lastPokeAt || now - every / 2) > every && now - (s.sched.lastFiredAt || 0) > 10 * MIN) {
      s.sched.lastPokeAt = now; poke = true;
    }
    if (!s.sched.lastPokeAt) s.sched.lastPokeAt = now;
    return s;
  });
  if (event) onTimerEvent(event);
  if (fire) showReminder(fire);
  if (poke) doPoke();
  renderTimer(st.timer); updateLoop(st.timer);
}

async function onTimerEvent(ev) {
  if (ev.type === 'focusDone') {
    sprite.play('joy');
    const text = say('praiseFocus', { min: ev.minutes });
    bubble(text, { ttl: 8000, important: true });
    if (document.hidden || !settings.mascotVisible) invoke('notify', { title: 'I AM · Фокус завершён', body: text });
    emit('praise', { kind: 'focus' });
  } else {
    bubble(say('breakDone'), { ttl: 8000, important: true, actions: [{ label: 'Ещё фокус', primary: true, run: () => { toggleTimer(); hideBubble(); } }] });
    if (document.hidden || !settings.mascotVisible) invoke('notify', { title: 'I AM · Перерыв закончился', body: 'Можно продолжать, когда будешь готов.' });
  }
}

async function doPoke() {
  const tasks = await repo.get('tasks');
  const today = Tasks.today(tasks);
  const r = Math.random();
  if (!today.length) bubble(say('noTasks'), { actions: [{ label: 'Добавить', primary: true, run: () => { invoke('open_main', { tab: 'tasks' }); hideBubble(); } }] });
  else if (!today.some((t) => t.done) && r < 0.6) bubble(say('start'), { actions: [{ label: 'Таймер 25 мин', primary: true, run: () => { toggleTimer(); hideBubble(); } }] });
  else if (settings.initiative >= 2 && r < 0.2) { sprite.play('silly'); bubble(say('silly'), { ttl: 4000 }); }
  else bubble(say(r < 0.6 ? 'idle' : 'poke'));
}

// ---------------- события от других окон и ядра ----------------
listen('store-changed', async (e) => {
  if (e.payload.name === 'settings') { settings = await repo.get('settings'); applySettings(); }
  if (e.payload.name === 'state') { const s = await repo.get('state'); renderTimer(s.timer); updateLoop(s.timer); }
});
listen('mascot-play', (e) => { const p = e.payload; if (p.anim) sprite.play(p.anim, { duration: p.duration }); if (p.text) bubble(p.text, { ttl: p.ttl || 6000, important: !!p.important }); });
listen('llm-busy', async (e) => { llmBusy = !!e.payload.busy; const s = await repo.get('state'); updateLoop(s.timer); });
listen('task-done', (e) => {
  sprite.play('joy');
  bubble(e.payload.all ? say('praiseAll') : say('praiseTask'), { ttl: 5000, important: true });
});
listen('tray', (e) => { const a = e.payload.action; if (a === 'dnd') toggleDnd(); if (a === 'timer') toggleTimer(); if (a === 'dance') sprite.play('dance', { duration: 6000 }); });
listen('tick', () => tick());
// ядро сообщает, что окно маскота скрыто/показано: останавливаем отрисовку полностью
listen('mascot-visibility', (e) => { settings.mascotVisible = !!e.payload.visible; sprite.setPaused(!e.payload.visible); });

function applySettings() {
  sprite.setMode(settings.animations);
  sprite.setScale(settings.mascotScale);
  syncDnd(false); relayout();
}

async function main() {
  settings = await repo.get('settings');
  await sprite.init(); applySettings();
  await repo.update('state', (s) => { s.sched = Sched.pruneCustom(Sched.normalize(s.sched, settings)); return s; });
  const st = await repo.get('state'); renderTimer(st.timer); updateLoop(st.timer);
  if (!settings.firstRunDone) { invoke('open_main', { tab: 'welcome' }); sprite.play('greet'); }
  else if (st.sched.greetedDay !== dayKey()) {
    await repo.update('state', (s) => { s.sched.greetedDay = dayKey(); return s; });
    sprite.play('greet'); bubble(say('hello', { name: settings.userName }), { ttl: 7000 });
  }
  setInterval(tick, 15000);                     // запасной таймер (основной — событие tick из ядра)
  setInterval(() => {
    if (!timerCache || !timerCache.running) return;
    if (Timer.left(timerCache) === 0) { tick(); return; }
    if (!document.hidden) renderTimer(timerCache);
  }, 1000);
  tick();
  if (!isTauri) window.__mascot = { sprite, tick, showReminder, bubble };
  // самопроверка в CI: приложение запущено с --selftest=1 / --selftest=2
  let phase = 0; try { phase = isTauri ? await invoke('selftest_phase') : 0; } catch {}
  if (phase) {
    if (phase === 2) invoke('open_main', { tab: 'chat' });
    const { selftest } = await import('./selftest.js');
    await selftest(phase, { tick, clearFire: () => { currentFire = null; }, reloadSettings: async () => { settings = await repo.get('settings'); applySettings(); } });
    sprite.play('dance', { duration: 20000 }); bubble('Самопроверка завершена', { ttl: 0, important: true });
    setTimeout(() => invoke('quit_app'), 25000);
  }
}
main();
