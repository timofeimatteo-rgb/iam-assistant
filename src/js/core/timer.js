// Таймер фокуса и отдыха. Хранит абсолютное время окончания, поэтому
// не «отстаёт», если окно было скрыто или компьютер засыпал.
import { MIN } from './time.js';

export function phaseLength(cfg, phase) {
  return (phase === 'focus' ? cfg.focus : phase === 'long' ? cfg.long : cfg.short) * MIN;
}

export function start(t, cfg, phase, now = Date.now()) {
  return { ...t, phase, running: true, endsAt: now + phaseLength(cfg, phase), remaining: 0, startedAt: now };
}
export function pause(t, now = Date.now()) {
  if (!t.running) return t;
  return { ...t, running: false, remaining: Math.max(0, t.endsAt - now) };
}
export function resume(t, now = Date.now()) {
  if (t.running || t.phase === 'idle') return t;
  return { ...t, running: true, endsAt: now + t.remaining, remaining: 0 };
}
export function stop(t) { return { ...t, phase: 'idle', running: false, endsAt: 0, remaining: 0 }; }
export function left(t, now = Date.now()) { return t.running ? Math.max(0, t.endsAt - now) : t.remaining; }

// Проверка на тике. Возвращает {timer, event}, event = null | {type:'focusDone'|'breakDone', ...}
export function tick(t, cfg, now = Date.now()) {
  if (!t.running || now < t.endsAt) return { timer: t, event: null };
  if (t.phase === 'focus') {
    const cycle = (t.cycle || 0) + 1;
    const next = cycle % cfg.longEvery === 0 ? 'long' : 'short';
    const base = { ...t, cycle };
    const timer = cfg.autoBreak ? start(base, cfg, next, now) : { ...stop(base), cycle };
    return { timer, event: { type: 'focusDone', cycle, next, minutes: cfg.focus } };
  }
  return { timer: stop(t), event: { type: 'breakDone', phase: t.phase } };
}
