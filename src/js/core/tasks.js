// Задачи на день. Незавершённые задачи прошлых дней остаются в списке («переехали»).
import { dayKey } from './time.js';

const uid = (now) => 't' + now.toString(36) + Math.random().toString(36).slice(2, 6);

export function add(state, title, { parentId = null, now = Date.now() } = {}) {
  title = String(title || '').trim().replace(/\s+/g, ' ').slice(0, 300);
  if (!title) return { state, item: null };
  const item = { id: uid(now), title, done: false, createdAt: now, day: dayKey(now), doneAt: 0, parentId };
  return { state: { ...state, items: [...state.items, item] }, item };
}

export function addMany(state, titles, opts) {
  const items = [];
  for (const t of titles) { const r = add(state, t, opts); state = r.state; if (r.item) items.push(r.item); }
  return { state, items };
}

export function toggle(state, id, now = Date.now()) {
  let changed = null;
  const items = state.items.map((t) => {
    if (t.id !== id) return t;
    changed = { ...t, done: !t.done, doneAt: !t.done ? now : 0 };
    return changed;
  });
  let currentId = state.currentId;
  if (changed && changed.done && currentId === id) currentId = null;
  return { state: { ...state, items, currentId }, item: changed };
}

export function rename(state, id, title) {
  return { ...state, items: state.items.map((t) => (t.id === id ? { ...t, title: String(title).trim() || t.title } : t)) };
}
export function remove(state, id) {
  return { ...state, items: state.items.filter((t) => t.id !== id && t.parentId !== id), currentId: state.currentId === id ? null : state.currentId };
}
export function setCurrent(state, id) { return { ...state, currentId: id }; }

// Список на сегодня: задачи сегодняшнего дня + незавершённые с прошлых дней.
export function today(state, now = Date.now()) {
  const k = dayKey(now);
  return state.items.filter((t) => t.day === k || (!t.done && t.day < k) || (t.done && dayKey(t.doneAt) === k));
}

// Удаляем выполненные задачи старше 14 дней, чтобы файл не рос бесконечно.
export function prune(state, now = Date.now()) {
  const lim = now - 14 * 86400_000;
  return { ...state, items: state.items.filter((t) => !t.done || t.doneAt > lim) };
}

// Нечёткий поиск задачи по словам из фразы пользователя.
export function find(state, query, now = Date.now()) {
  const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2).map((w) => w.slice(0, Math.max(3, w.length - 2)));
  const q = norm(query); if (!q.length) return null;
  let best = null, score = 0;
  for (const t of today(state, now)) {
    const w = norm(t.title); const s = q.filter((x) => w.some((y) => y.startsWith(x) || x.startsWith(y))).length / Math.max(q.length, 1);
    if (s > score) { score = s; best = t; }
  }
  return score >= 0.5 ? best : null;
}
