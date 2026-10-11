// Доступ к сохранённым данным: «загрузить → изменить → сохранить» с очередью внутри окна.
import { load, save } from './bridge.js';
import { DEFAULT_SETTINGS, DEFAULT_TASKS, DEFAULT_STATE, DEFAULT_CHAT, DEFAULT_MEMORY } from './defaults.js';

export const FILES = { settings: DEFAULT_SETTINGS, tasks: DEFAULT_TASKS, state: DEFAULT_STATE, chat: DEFAULT_CHAT, memory: DEFAULT_MEMORY };

function deepMerge(base, v) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return v === undefined ? base : v;
  const out = { ...base };
  for (const k of Object.keys(v || {})) out[k] = k in base ? deepMerge(base[k], v[k]) : v[k];
  return out;
}

let q = Promise.resolve();
const serial = (fn) => (q = q.then(fn, fn));

export const get = (name) => serial(async () => deepMerge(FILES[name], await load(name, {})));
export const put = (name, data) => serial(() => save(name, data));
// fn получает свежую копию и возвращает новую (или изменяет на месте)
export const update = (name, fn) => serial(async () => {
  const cur = deepMerge(FILES[name], await load(name, {}));
  const next = (await fn(cur)) ?? cur;
  await save(name, next);
  return next;
});
