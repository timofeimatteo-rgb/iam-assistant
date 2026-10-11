// Подготовка запроса к локальной модели и разбор ответа.
// Модель НЕ выполняет действия сама: она может только предложить их особыми метками,
// а приложение показывает карточку, и данные меняются только после нажатия пользователя.
import { hm, dayKey } from './time.js';

const WEEK = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export function systemPrompt({ name, facts = [], tasks = [], current = null, now = Date.now() }) {
  const d = new Date(now);
  const lines = [
    'Ты — маскот дизайн-студии I AM: чёрный кот-робот с красным ошейником, тёплый, заботливый и немного озорной напарник по работе.',
    'Отвечай по-русски, коротко (обычно 1–4 предложения), естественно, с лёгким юмором. Без давления, упрёков и чувства вины. Не используй эмодзи чаще одного раза за ответ.',
    'Ты работаешь полностью на компьютере пользователя, без интернета. Если не знаешь фактов — честно скажи об этом.',
    'Ты не можешь сам менять задачи и напоминания. Ты можешь только ПРЕДЛОЖИТЬ действие, добавив в конце ответа метку на отдельной строке:',
    '[[задача: текст задачи]] — предложить добавить задачу;',
    '[[напомнить: ЧЧ:ММ | текст]] — предложить напоминание на время сегодня;',
    '[[напомнить через: N | текст]] — предложить напоминание через N минут;',
    '[[шаги: шаг 1; шаг 2; шаг 3]] — предложить разбить задачу на небольшие шаги (3–7 шагов, каждый — конкретное действие на 5–25 минут);',
    '[[запомнить: факт о пользователе]] — только если пользователь сам просит что-то запомнить.',
    'Никогда не пиши, что уже поставил напоминание, добавил задачу или что-то запомнил: пользователь подтверждает это кнопкой. Пиши «предлагаю» или «могу добавить».',
    `Сейчас ${WEEK[d.getDay()]}, ${dayKey(now)}, ${hm(now)}.`,
  ];
  if (name) lines.push(`Пользователя зовут ${name}.`);
  if (facts.length) lines.push('Что пользователь разрешил о себе помнить: ' + facts.map((f) => f.text).join('; ') + '.');
  if (tasks.length) {
    const open = tasks.filter((t) => !t.done).slice(0, 12).map((t) => '— ' + t.title);
    const done = tasks.filter((t) => t.done).length;
    lines.push(`Задачи на сегодня (выполнено ${done}):\n` + (open.join('\n') || 'все выполнены'));
  }
  if (current) lines.push(`Текущая задача: ${current.title}.`);
  return lines.join('\n');
}

export function buildRequest({ system, history, user, maxTokens = 400 }) {
  const msgs = [{ role: 'system', content: system }];
  for (const m of history.slice(-10)) if (m.role === 'user' || m.role === 'assistant') msgs.push({ role: m.role, content: m.content });
  msgs.push({ role: 'user', content: user });
  return { messages: msgs, temperature: 0.7, top_p: 0.9, max_tokens: maxTokens, stream: true };
}

export function breakdownRequest(title) {
  return {
    messages: [
      { role: 'system', content: 'Ты помогаешь разбивать рабочие задачи на маленькие конкретные шаги. Отвечай по-русски. Выведи только нумерованный список из 3–7 шагов, каждый шаг — одно короткое действие на 5–25 минут, начинай с глагола. Без вступления и пояснений.' },
      { role: 'user', content: 'Задача: ' + title },
    ],
    temperature: 0.4, max_tokens: 300, stream: true,
  };
}

// Нумерованный или маркированный список → массив шагов
export function parseSteps(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => /^(\d+[.)]|[-–—•*])\s+/.test(l))
    .map((l) => l.replace(/^(\d+[.)]|[-–—•*])\s+/, '').replace(/\*\*/g, '').trim()).filter(Boolean).slice(0, 10);
}

// Разбор меток действий в ответе модели.
const TAG = /\[\[\s*(задача|напомнить через|напомнить|шаги|запомнить)\s*:\s*([^\]]+?)\s*\]\]/gi;
export function extractActions(text, now = Date.now()) {
  const actions = [];
  const clean = text.replace(TAG, (_, kind, body) => {
    kind = kind.toLowerCase();
    if (kind === 'задача') actions.push({ type: 'addTask', title: body.trim() });
    else if (kind === 'шаги') actions.push({ type: 'addSteps', steps: body.split(/;|\n/).map((s) => s.trim()).filter(Boolean) });
    else if (kind === 'запомнить') actions.push({ type: 'remember', fact: body.trim() });
    else if (kind === 'напомнить через') {
      const [n, ...rest] = body.split('|'); const min = parseInt(n, 10);
      if (min > 0 && min < 24 * 60) actions.push({ type: 'reminder', at: now + min * 60_000, text: rest.join('|').trim() || 'Напоминание' });
    } else {
      const [time, ...rest] = body.split('|'); const m = /(\d{1,2})[:.](\d{2})/.exec(time);
      if (m) {
        const d = new Date(now); d.setHours(+m[1], +m[2], 0, 0); if (d.getTime() <= now) d.setDate(d.getDate() + 1);
        actions.push({ type: 'reminder', at: d.getTime(), text: rest.join('|').trim() || 'Напоминание' });
      }
    }
    return '';
  });
  // недописанная метка в конце потока не должна мелькать в тексте
  return { text: clean.replace(/\[\[[^\]]*$/, '').replace(/\n{3,}/g, '\n\n').trim(), actions };
}

// Защита от ложных заявлений: модель не должна утверждать, что что-то сохранено.
const CLAIM = /(^|[.!?\n]\s*)((?:готово[,!—\s]*)?(?:я\s+)?(?:уже\s+|только что\s+)?(?:поставил[аи]?|установил[аи]?|создал[аи]?|добавил[аи]?|сохранил[аи]?|запомнил[аи]?|записал[аи]?|завел[аи]?|завёл)(?![а-я])[^.!?\n]*?(?:напоминани|задач|будильник|запомн|список|памят)[^.!?\n]*[.!?]?)/gi;
export function guardClaims(text, hasActions) {
  let flagged = false;
  const out = text.replace(CLAIM, (_, pre) => { flagged = true; return pre + (hasActions ? 'Предлагаю это сделать — подтвердите ниже.' : ''); });
  return { text: out.replace(/\s{2,}/g, ' ').trim(), flagged };
}
