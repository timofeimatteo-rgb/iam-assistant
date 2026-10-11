// Распознавание простых команд в чате без языковой модели.
// Всё, что меняет данные (задачи, напоминания, «Не беспокоить»), выполняется приложением,
// а не «на словах» моделью.
import { MIN, HOUR } from './time.js';

const NUM = { одну: 1, один: 1, одна: 1, две: 2, два: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, пятнадцать: 15, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, полтора: 1.5 };
const num = (s) => (s == null ? null : /^\d+([.,]\d+)?$/.test(s) ? parseFloat(s.replace(',', '.')) : NUM[s.toLowerCase()] ?? null);

// Ищет выражение времени. Возвращает {at, match} или null.
export function parseWhen(text, now = Date.now()) {
  const t = text.toLowerCase().replace(/ё/g, 'е');
  let m;
  if ((m = /через\s+полчаса/.exec(t))) return { at: now + 30 * MIN, match: m[0] };
  if ((m = /через\s+(?:(\S+)\s+)?(минуту|минуты|минут|мин\.?|час|часа|часов|ч\.?)(?=\s|$|[,.!?])/.exec(t))) {
    const n = m[1] ? num(m[1]) : 1; if (n == null) return null;
    const unit = m[2].startsWith('ч') ? HOUR : MIN;
    return { at: now + Math.round(n * unit), match: m[0] };
  }
  const tomorrow = /(?<![а-яё])завтра(?![а-яё])/.test(t);
  if ((m = /(?:^|\s)(?:завтра\s+)?в\s+(\d{1,2})[:.](\d{2})(?=\s|$|[,.!?])/.exec(t)) || (m = /(?:^|\s)(?:завтра\s+)?в\s+(\d{1,2})\s*(?:час(?:а|ов)?)?\s*(утра|дня|вечера)?(?=\s|$|[,.!?])/.exec(t))) {
    let h = +m[1], mi = m[2] && /^\d+$/.test(m[2]) ? +m[2] : 0;
    const part = m[3] || (m[2] && !/^\d+$/.test(m[2]) ? m[2] : null);
    if ((part === 'дня' || part === 'вечера') && h < 12) h += 12;
    if (h > 23 || mi > 59) return null;
    const d = new Date(now); d.setHours(h, mi, 0, 0);
    if (tomorrow) d.setDate(d.getDate() + 1);
    else if (d.getTime() <= now) {
      // «в 3» днём, если сейчас уже позже 3 утра: вероятно, имеется в виду 15:00
      if (h < 12 && !part && !(m[2] && /^\d+$/.test(m[2])) && d.getTime() + 12 * HOUR > now) d.setHours(h + 12);
      else d.setDate(d.getDate() + 1);
    }
    const match = tomorrow && !m[0].includes('завтра') ? m[0] + ' завтра' : m[0];
    return { at: d.getTime(), match, tomorrow };
  }
  return null;
}

const clean = (s) => s.replace(/\s+/g, ' ').replace(/^[\s,:—-]+|[\s,.!?:—-]+$/g, '').trim();
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function parse(input, now = Date.now()) {
  const raw = String(input || '').trim(); if (!raw) return null;
  const t = raw.toLowerCase().replace(/ё/g, 'е');
  let m;

  // напоминания
  if (/^(пожалуйста\s+)?напомн(и|ите)(?![а-яё])|(?<![а-яё])напомни(те)?\s+(мне|нам)(?![а-яё])|^через .* напомни/.test(t)) {
    const w = parseWhen(raw, now);
    if (!w) return { type: 'reminderNeedsTime', text: raw };
    let rest = raw.replace(new RegExp(w.match.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
    rest = rest.replace(/завтра/i, ' ').replace(/^(\s*пожалуйста)?\s*напомн(и|ите)(\s+(мне|нам))?/i, ' ').replace(/напомн(и|ите)(\s+(мне|нам))?/i, ' ');
    rest = clean(rest).replace(/^(что|о|об|про|чтобы|что нужно|что надо)\s+/i, '');
    return { type: 'reminder', at: w.at, text: cap(clean(rest)) || 'Напоминание' };
  }
  // добавить задачу
  if ((m = /^(?:добавь|добавить|запиши|записать|создай|новая)\s+(?:мне\s+)?(?:задачу|задача|в задачи|в список|в план)[\s:,-]*(.+)$/i.exec(raw)) || (m = /^задача[\s:]+(.+)$/i.exec(raw))) {
    return { type: 'addTask', title: cap(clean(m[1])) };
  }
  // разбить на шаги
  if ((m = /(?:разбей|разбить|разложи|раздели|распиши)\s+(?:мне\s+)?(?:задачу\s+)?[«"]?(.+?)[»"]?\s+на\s+(?:шаги|этапы|части|подзадачи)/i.exec(raw))) {
    return { type: 'breakdown', title: cap(clean(m[1])) };
  }
  // отметить выполненной
  if ((m = /^(?:я\s+)?(?:сделал|сделала|закончил|закончила|выполнил|выполнила|доделал|доделала)\s+(.+)$/i.exec(raw)) || (m = /^отметь\s+(?:задачу\s+)?(.+?)\s+(?:как\s+)?(?:выполненн\S*|сделанн\S*|готов\S*)$/i.exec(raw))) {
    return { type: 'completeTask', query: clean(m[1]) };
  }
  // таймер
  if (/(запусти|включи|начни|начать|старт|поставь)\s+(таймер|фокус|помидор)/.test(t) || /^фокус( на|$)/.test(t)) {
    const mm = /на\s+(\d+)\s*(мин|минут)/.exec(t);
    return { type: 'timerStart', minutes: mm ? Math.min(180, +mm[1]) : null };
  }
  if (/^(пауза|поставь на паузу|приостанови таймер)/.test(t)) return { type: 'timerPause' };
  if (/(стоп|останови|выключи|сбрось)\s+таймер/.test(t)) return { type: 'timerStop' };
  if (/^(хочу\s+)?(перерыв|отдохнуть|передышк)/.test(t)) return { type: 'timerBreak' };
  // не беспокоить
  if (/можно беспокоить|выключи (режим )?не беспокоить|отключи не беспокоить/.test(t)) return { type: 'dndOff' };
  if (/не беспокой/.test(t)) {
    const w = /(\d+)\s*(ч|час|мин)/.exec(t);
    const ms = w ? (+w[1]) * (w[2].startsWith('м') ? MIN : HOUR) : /до завтра/.test(t) ? null : HOUR;
    return { type: 'dndOn', ms };
  }
  // память
  if ((m = /^запомни[,:]?\s+(?:что\s+)?(.+)$/i.exec(raw))) return { type: 'remember', fact: cap(clean(m[1])) };
  // развлечения
  if (/(станцуй|потанцуй|танцуй|потанцуем|танец)/.test(t)) return { type: 'dance' };
  if (/(подурачься|пошали|покажи трюк|рассмеши|сделай что-нибудь смешное)/.test(t)) return { type: 'silly' };
  if (/(подбодри|поддержи меня|мне грустно|у меня не получается)/.test(t)) return { type: 'cheer', passToLLM: true };
  return null;
}
