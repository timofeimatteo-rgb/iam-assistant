// Время, рабочие часы и режим «Не беспокоить». Чистые функции — покрыты тестами.
export const MIN = 60_000;
export const HOUR = 60 * MIN;

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function hm(ts) {
  const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function parseHM(s) {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(s).trim()); if (!m) return null;
  const h = +m[1], mi = +m[2]; if (h > 23 || mi > 59) return null; return h * 60 + mi;
}
export function minutesOfDay(ts) { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); }

// Рабочие часы: {enabled, start:'09:00', end:'18:00', days:[1..7] (1=пн)}
export function inWorkHours(wh, ts = Date.now()) {
  if (!wh || !wh.enabled) return true;
  const d = new Date(ts); const dow = d.getDay() === 0 ? 7 : d.getDay();
  if (wh.days && !wh.days.includes(dow)) return false;
  const s = parseHM(wh.start), e = parseHM(wh.end), m = minutesOfDay(ts);
  if (s == null || e == null) return true;
  return s <= e ? m >= s && m < e : m >= s || m < e; // поддержка ночных смен
}

export function dndActive(settings, ts = Date.now()) {
  return !!(settings.dnd && settings.dnd.until && settings.dnd.until > ts);
}

export function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000)); const m = Math.floor(s / 60), r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many; if (b > 1 && b < 5) return few; if (b === 1) return one; return many;
}
export function fmtBytes(b) {
  if (!b && b !== 0) return '—';
  if (b >= 2 ** 30) return (b / 2 ** 30).toFixed(1).replace('.', ',') + ' ГБ';
  if (b >= 2 ** 20) return (b / 2 ** 20).toFixed(b >= 100 * 2 ** 20 ? 0 : 1).replace('.', ',') + ' МБ';
  return Math.max(1, Math.round(b / 1024)) + ' КБ';
}
export function untilText(ts, now = Date.now()) {
  const m = Math.round((ts - now) / MIN);
  if (m < 60) return `${m} ${plural(m, 'минуту', 'минуты', 'минут')}`;
  return `до ${hm(ts)}`;
}
