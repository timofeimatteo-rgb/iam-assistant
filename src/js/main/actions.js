// Действия приложения. Каждое действие сохраняет данные, затем ПЕРЕЧИТЫВАЕТ их с диска
// и сообщает об успехе, только если изменение действительно сохранилось.
import * as repo from '../core/repo.js';
import * as Tasks from '../core/tasks.js';
import * as Sched from '../core/scheduler.js';
import * as Timer from '../core/timer.js';
import { emit } from '../core/bridge.js';
import { hm, dayKey, HOUR, untilText } from '../core/time.js';

const whenText = (at) => (dayKey(at) === dayKey() ? 'сегодня в ' : dayKey(at) === dayKey(Date.now() + 86400000) ? 'завтра в ' : new Date(at).toLocaleDateString('ru-RU') + ' в ') + hm(at);

export async function addTask(title, parentId = null) {
  let item;
  await repo.update('tasks', (s) => { const r = Tasks.add(s, title, { parentId }); item = r.item; return r.state; });
  const check = await repo.get('tasks');
  if (!item || !check.items.some((t) => t.id === item.id)) throw new Error('Задача не сохранилась');
  return { ok: true, text: `Задача «${item.title}» добавлена.`, item };
}
export async function addSteps(steps, parentTitle = null) {
  let parentId = null;
  if (parentTitle) { const t = await repo.get('tasks'); const p = Tasks.find(t, parentTitle) || t.items.find((x) => x.title === parentTitle); parentId = p ? p.id : null; }
  let items;
  await repo.update('tasks', (s) => { const r = Tasks.addMany(s, steps, { parentId }); items = r.items; return r.state; });
  const check = await repo.get('tasks');
  const saved = items.filter((i) => check.items.some((t) => t.id === i.id));
  if (saved.length !== items.length) throw new Error('Не все шаги сохранились');
  return { ok: true, text: `Добавлено шагов: ${saved.length}.` };
}
export async function reminder(at, text) {
  let item;
  await repo.update('state', (s) => { const r = Sched.addCustom(s.sched, { text, at }); s.sched = r.sched; item = r.item; return s; });
  const check = await repo.get('state');
  if (!check.sched.custom.some((c) => c.id === item.id)) throw new Error('Напоминание не сохранилось');
  const mins = Math.round((at - Date.now()) / 60000);
  return { ok: true, text: `Напоминание «${item.text}» — ${whenText(at)}${mins < 60 ? ` (через ${untilText(at)})` : ''}.`, item };
}
export async function removeReminder(id) { await repo.update('state', (s) => { s.sched = Sched.removeCustom(s.sched, id); return s; }); }
export async function remember(fact) {
  const id = 'f' + Date.now().toString(36);
  await repo.update('memory', (m) => { m.facts.push({ id, text: fact, at: Date.now() }); return m; });
  const check = await repo.get('memory');
  if (!check.facts.some((f) => f.id === id)) throw new Error('Не сохранилось');
  return { ok: true, text: `Запомнил: «${fact}». Посмотреть и удалить можно в «Настройки → Память и данные».` };
}
export async function completeTask(id) {
  let item, allDone = false;
  await repo.update('tasks', (s) => { const r = Tasks.toggle(s, id); item = r.item; const today = Tasks.today(r.state); allDone = today.length > 1 && today.every((t) => t.done); return r.state; });
  if (item && item.done) {
    await repo.update('state', (s) => { const k = dayKey(); s.stats[k] = s.stats[k] || { focus: 0, tasks: 0 }; s.stats[k].tasks++; return s; });
    emit('task-done', { id, all: allDone });
  }
  return item;
}
export async function setDnd(ms) {
  const until = ms === null ? (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d.getTime(); })() : Date.now() + ms;
  await repo.update('settings', (s) => { s.dnd = { until }; return s; });
  return { ok: true, text: `«Не беспокоить» включён до ${hm(until)}. Напоминания подождут.` };
}
export async function dndOff() { await repo.update('settings', (s) => { s.dnd = { until: 0 }; return s; }); return { ok: true, text: '«Не беспокоить» выключен.' }; }

export async function timer(cmd, minutes) {
  const settings = await repo.get('settings');
  const cfg = minutes ? { ...settings.timer, focus: minutes } : settings.timer;
  const st = await repo.update('state', (s) => {
    if (cmd === 'start') s.timer = Timer.start(s.timer, cfg, 'focus');
    if (cmd === 'break') s.timer = Timer.start(s.timer, cfg, 'short');
    if (cmd === 'pause') s.timer = s.timer.running ? Timer.pause(s.timer) : Timer.resume(s.timer);
    if (cmd === 'stop') s.timer = Timer.stop(s.timer);
    return s;
  });
  return st.timer;
}
export { HOUR };
