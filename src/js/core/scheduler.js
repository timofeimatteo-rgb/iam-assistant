// Напоминания: периодические (глаза, вода, перерыв, зарядка) и разовые (созданные пользователем).
// Работают без языковой модели. Учитывают рабочие часы, «Не беспокоить» и сеанс фокуса.
import { MIN, inWorkHours, dndActive } from './time.js';

export const GAP = 3 * MIN;          // не чаще одного напоминания за 3 минуты
export const SNOOZE = 10 * MIN;

// Привести расписание в соответствие с настройками (новые типы, изменённые интервалы).
export function normalize(sched, settings, now = Date.now()) {
  const next = { ...(sched.next || {}) };
  for (const [k, r] of Object.entries(settings.reminders)) {
    if (!r.enabled) { delete next[k]; continue; }
    const max = now + r.every * MIN;
    if (!next[k] || next[k] > max) next[k] = max;
  }
  for (const k of Object.keys(next)) if (!settings.reminders[k]) delete next[k];
  return { ...sched, next, custom: sched.custom || [] };
}

// Можно ли сейчас показывать периодические напоминания.
function periodicAllowed(settings, ctx, now) {
  if (dndActive(settings, now)) return false;
  if (!inWorkHours(settings.workHours, now)) return false;
  if (settings.holdDuringFocus && ctx.focusRunning) return false;
  return true;
}

// Один тик. Возвращает {sched, fire: null | {kind:'periodic'|'custom', key|id, ...}}
export function tick(sched, settings, ctx, now = Date.now()) {
  sched = normalize(sched, settings, now);
  if (now - (sched.lastFiredAt || 0) < GAP) return { sched, fire: null };
  // 1) разовые напоминания пользователя — приоритет; в «Не беспокоить» ждут окончания режима
  const due = sched.custom.filter((c) => !c.done && c.at <= now).sort((a, b) => a.at - b.at)[0];
  if (due && !dndActive(settings, now)) {
    const custom = sched.custom.map((c) => (c.id === due.id ? { ...c, done: true, firedAt: now } : c));
    return { sched: { ...sched, custom, lastFiredAt: now }, fire: { kind: 'custom', id: due.id, text: due.text, at: due.at, late: now - due.at > 2 * MIN } };
  }
  // 2) периодические
  const keys = Object.entries(sched.next).filter(([, t]) => t <= now).sort((a, b) => a[1] - b[1]);
  if (!keys.length) return { sched, fire: null };
  if (!periodicAllowed(settings, ctx, now)) {
    // вне рабочих часов не «копим» напоминания: переносим на полный интервал вперёд
    if (!inWorkHours(settings.workHours, now)) {
      const next = { ...sched.next };
      for (const [k] of keys) next[k] = now + settings.reminders[k].every * MIN;
      return { sched: { ...sched, next }, fire: null };
    }
    return { sched, fire: null };   // DND или фокус — подождём
  }
  const [key] = keys[0];
  // пока ждёт ответа — повторно не показываем
  const next = { ...sched.next, [key]: now + settings.reminders[key].every * MIN };
  return { sched: { ...sched, next, lastFiredAt: now }, fire: { kind: 'periodic', key } };
}

// Реакции пользователя на напоминание
export function respond(sched, settings, fire, action, now = Date.now()) {
  if (fire.kind === 'periodic') {
    const every = settings.reminders[fire.key].every * MIN;
    const next = { ...sched.next };
    if (action === 'snooze') next[fire.key] = now + SNOOZE;
    else if (action === 'done' || action === 'skip') next[fire.key] = now + every;
    return { ...sched, next };
  }
  if (action === 'snooze') {
    return { ...sched, custom: sched.custom.map((c) => (c.id === fire.id ? { ...c, done: false, at: now + SNOOZE } : c)) };
  }
  return sched;
}

export function addCustom(sched, { text, at }, now = Date.now()) {
  const id = 'r' + now.toString(36) + Math.random().toString(36).slice(2, 6);
  const item = { id, text: String(text).trim() || 'Напоминание', at, createdAt: now, done: false };
  return { sched: { ...sched, custom: [...(sched.custom || []), item] }, item };
}
export function removeCustom(sched, id) { return { ...sched, custom: sched.custom.filter((c) => c.id !== id) }; }
export function pruneCustom(sched, now = Date.now()) {   // убираем сработавшие старше суток
  return { ...sched, custom: (sched.custom || []).filter((c) => !c.done || now - (c.firedAt || c.at) < 24 * 60 * MIN) };
}
