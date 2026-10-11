// Настройки: маскот, модель ИИ, напоминания, рабочие часы, таймер, память, система.
import * as repo from '../core/repo.js';
import { invoke, listen } from '../core/bridge.js';
import { MODELS, recommend, fits, diskNeeded } from '../core/models.js';
import { llm } from './llmctl.js';
import { clearHistory } from './chat.js';
import { h, $, toast, ask } from '../ui/dom.js';
import { fmtBytes, hm, dndActive } from '../core/time.js';
import { REMINDER_INFO } from '../core/defaults.js';

let S; // текущие настройки

const save = async (fn) => { S = await repo.update('settings', (s) => { fn(s); return s; }); };

function block(id, n, title, lead, ...rows) {
  return h('section.sblock', { id }, h('h2', {}, title), lead && h('p.lead', {}, lead), ...rows);
}
function row(label, hint, control) { return h('div.srow', {}, h('div.sl', {}, h('b', {}, label), hint && h('small', {}, hint)), control); }
function toggle(checked, onChange) {
  return h('label.switch', {}, h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), h('span'));
}
function seg(options, value, onChange) {
  const wrap = h('div.seg', { role: 'group' });
  for (const [v, label] of options) {
    wrap.append(h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => { for (const b of wrap.children) b.setAttribute('aria-pressed', 'false'); wrap.children[options.findIndex((o) => o[0] === v)].setAttribute('aria-pressed', 'true'); onChange(v); } }, label));
  }
  return wrap;
}
function num(value, min, max, onChange, step = 1) {
  return h('input.input.short', { type: 'number', min, max, step, value, onchange: (e) => { const v = Math.min(max, Math.max(min, +e.target.value || min)); e.target.value = v; onChange(v); } });
}

export async function renderSettings() {
  S = await repo.get('settings');
  await llm.refresh();
  const root = $('#settingsRoot'); const keep = root.scrollTop; root.replaceChildren(
    mascotBlock(), modelBlock(), remindBlock(), hoursBlock(), timerBlock(), await dataBlock(), await systemBlock(), aboutBlock());
  root.scrollTop = keep;
}

function mascotBlock() {
  return block('s-mascot', '01', 'Маскот', 'Характер и поведение напарника на рабочем столе.',
    row('Сообщения маскота', 'Полностью выключить реплики. Напоминания настраиваются отдельно.', toggle(S.messagesEnabled, (v) => save((s) => (s.messagesEnabled = v)))),
    row('Инициативность', 'Как часто маскот заговаривает первым.', seg([[0, 'Молчит'], [1, 'Редко'], [2, 'Обычно'], [3, 'Часто']], S.initiative, (v) => save((s) => (s.initiative = v)))),
    row('Анимации', '«Сдержанно» — меньше движения и вдвое меньше кадров. «Выкл» — только статичные позы.', seg([['full', 'Полные'], ['reduced', 'Сдержанно'], ['off', 'Выкл']], S.animations, (v) => save((s) => (s.animations = v)))),
    row('Размер маскота', null, seg([[0.75, 'S'], [1, 'M'], [1.25, 'L'], [1.5, 'XL']], S.mascotScale, (v) => save((s) => (s.mascotScale = v)))),
    row('Поверх всех окон', null, toggle(S.onTop, (v) => { save((s) => (s.onTop = v)); invoke('mascot_set_on_top', { onTop: v }); })),
    row('Показывать маскота', 'Скрытый маскот живёт в трее Windows или строке меню macOS и не тратит ресурсы на отрисовку.', toggle(S.mascotVisible, (v) => { save((s) => (s.mascotVisible = v)); invoke('mascot_set_visible', { visible: v }); })),
    row('Звук', 'Короткий сигнал при напоминании. По умолчанию выключен.', toggle(S.sound, (v) => save((s) => (s.sound = v)))),
  );
}

function modelBlock() {
  const sys = llm.sys || {}; const rec = recommend(sys.total_ram);
  const status = llm.status || {};
  const cards = MODELS.map((m) => {
    const installed = llm.isInstalled(m.id); const active = installed && S.model.id === m.id;
    const dl = llm.downloads[m.id];
    const tooBig = !fits(m, sys.total_ram);
    const noDisk = sys.free_disk && sys.free_disk < diskNeeded(m) && !installed;
    const btns = h('div.mc-btns');
    if (dl && dl.state !== 'error') {
      btns.append(h('button.btn', { onclick: () => llm.cancelDownload(m) }, 'Остановить загрузку'));
    } else if (!installed) {
      btns.append(h('button.btn.blue', { disabled: noDisk, onclick: async () => { try { await llm.download(m); await save((s) => { if (!s.model.id || !llm.isInstalled(s.model.id)) s.model.id = m.id; }); renderSettings(); } catch (e) { toast('Загрузка не удалась: ' + e); renderSettings(); } } }, `Скачать · ${fmtBytes(m.size)}`));
    } else {
      if (!active) btns.append(h('button.btn.primary', { onclick: async () => { await save((s) => (s.model.id = m.id)); if (llm.status.state === 'ready') await llm.unload(); renderSettings(); } }, 'Использовать'));
      else btns.append(h('span.tag', {}, 'Используется'));
      btns.append(h('button.btn.ghost.small', { onclick: async () => { if (!await ask(`Удалить модель «${m.name}» (${fmtBytes(m.size)})? Её можно будет скачать снова.`)) return; await llm.remove(m); await save((s) => { if (s.model.id === m.id) s.model.id = null; }); renderSettings(); } }, 'Удалить с диска'));
    }
    const card = h('div.model-card', { class: active ? 'active' : '' },
      h('div', {}, h('div.mc-tier', {}, m.tier + (m.id === rec ? ' · рекомендуем' : '')), h('h3', {}, m.name), h('div', {}, m.note),
        h('div.specs', {}, h('span', {}, 'Загрузка: ', h('b', {}, fmtBytes(m.size))), h('span', {}, 'Место на диске: ', h('b', {}, fmtBytes(diskNeeded(m)))), h('span', {}, 'Память при общении: ', h('b', {}, '≈ ' + fmtBytes(m.ramChat))), h('span', {}, 'Нужно ОЗУ: ', h('b', {}, 'от ' + fmtBytes(m.minRam))), h('span', {}, m.vendor + ' · ' + m.license)),
        tooBig && h('div.warn', {}, 'На этом компьютере может работать медленно или не хватить памяти.'),
        noDisk && h('div.warn', {}, `Недостаточно места на диске: свободно ${fmtBytes(sys.free_disk)}.`),
        dl && dl.state === 'error' && h('div.warn', {}, 'Ошибка загрузки: ' + dl.error + '. Нажмите «Скачать», чтобы продолжить с того же места.')),
      btns);
    if (dl && dl.state !== 'error') card.append(h('div.dl', {}, h('div.progress', {}, h('i', { style: `width:${(100 * dl.received / (dl.total || m.size)).toFixed(1)}%` })), h('small.muted', { style: 'display:block;margin-top:6px' }, `${fmtBytes(dl.received)} из ${fmtBytes(dl.total || m.size)}${dl.state === 'verifying' ? ' · проверка файла…' : ''}`)));
    return card;
  });
  const stText = { ready: 'загружена в память', loading: 'загружается…', stopped: 'не загружена (запустится при первом сообщении в чате)', error: 'ошибка запуска' }[status.state] || status.state;
  return block('s-model', '02', 'Модель ИИ', 'Модель работает прямо на компьютере: без интернета, подписок и ключей. Переписка никуда не отправляется. Скачивается один раз.',
    ...cards,
    row('Состояние', stText + (status.rss ? ` · занимает ${fmtBytes(status.rss)} ОЗУ` : ''), status.state === 'ready'
      ? h('button.btn', { onclick: async () => { await llm.unload(); toast('Модель выгружена. Следующий ответ займёт больше времени — модель загрузится заново.'); renderSettings(); } }, 'Выгрузить из памяти')
      : h('span')),
    row('Выгружать при простое', 'Освобождает оперативную память, если чатом не пользуются. Следующий ответ после выгрузки — на 10–40 секунд дольше.', seg([[5, '5 мин'], [10, '10 мин'], [30, '30 мин'], [0, 'Никогда']], S.model.unloadAfter, (v) => { save((s) => (s.model.unloadAfter = v)); invoke('llm_config', { unloadAfter: v }); })),
    row('Ускорение', '«Авто» использует видеоядро (Metal на Mac, Vulkan на Windows). Если возникают ошибки — выберите «Процессор».', seg([['auto', 'Авто'], ['cpu', 'Процессор']], S.model.accel, (v) => save((s) => (s.model.accel = v)).then(() => llm.status.state === 'ready' && llm.unload()))),
    row('Длина контекста', 'Сколько текста модель «помнит» в разговоре. Больше — дольше и требует больше памяти.', seg([[2048, '2K'], [4096, '4K'], [8192, '8K']], S.model.ctx, (v) => save((s) => (s.model.ctx = v)).then(() => llm.status.state === 'ready' && llm.unload()))),
  );
}

function remindBlock() {
  const rows = Object.entries(REMINDER_INFO).map(([k, info]) => row(info.title, info.text,
    h('div.row', {}, h('span.muted', {}, 'каждые'), num(S.reminders[k].every, 10, 240, (v) => save((s) => (s.reminders[k].every = v)), 5), h('span.muted', {}, 'мин'), toggle(S.reminders[k].enabled, (v) => save((s) => (s.reminders[k].enabled = v))))));
  return block('s-remind', '03', 'Напоминания', 'Каждое напоминание можно отложить на 10 минут, пропустить или отключить прямо из реплики маскота.',
    ...rows,
    row('Не прерывать фокус', 'Во время сеанса фокуса напоминания ждут перерыва.', toggle(S.holdDuringFocus, (v) => save((s) => (s.holdDuringFocus = v)))),
  );
}

function hoursBlock() {
  const wh = S.workHours; const names = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const days = h('div.days', {}, names.map((n, i) => h('label', {}, h('input', { type: 'checkbox', checked: wh.days.includes(i + 1), onchange: (e) => save((s) => { const d = new Set(s.workHours.days); e.target.checked ? d.add(i + 1) : d.delete(i + 1); s.workHours.days = [...d].sort(); }) }), h('span', {}, n))));
  const dndOn = dndActive(S);
  return block('s-hours', '04', 'Рабочие часы и «Не беспокоить»', 'Вне рабочих часов маскот не напоминает и не заговаривает первым.',
    row('Учитывать рабочие часы', null, toggle(wh.enabled, (v) => save((s) => (s.workHours.enabled = v)))),
    row('Время', null, h('div.row', {}, h('input.input.short', { type: 'time', value: wh.start, onchange: (e) => save((s) => (s.workHours.start = e.target.value)) }), '—', h('input.input.short', { type: 'time', value: wh.end, onchange: (e) => save((s) => (s.workHours.end = e.target.value)) }))),
    row('Дни', null, days),
    row('Не беспокоить', dndOn ? `Включён до ${hm(S.dnd.until)}` : 'Маскот молчит, напоминания ждут окончания режима.',
      dndOn ? h('button.btn', { onclick: async () => { await save((s) => (s.dnd = { until: 0 })); renderSettings(); } }, 'Выключить')
        : h('div.row', {}, [[30, '30 мин'], [60, '1 час'], [120, '2 часа']].map(([m, l]) => h('button.btn.small', { onclick: async () => { await save((s) => (s.dnd = { until: Date.now() + m * 60000 })); renderSettings(); } }, l)))),
  );
}

function timerBlock() {
  const t = S.timer;
  return block('s-timer', '05', 'Таймер', 'Чередование фокуса и отдыха. За каждый завершённый сеанс маскот хвалит.',
    row('Фокус', 'минут', num(t.focus, 5, 180, (v) => save((s) => (s.timer.focus = v)), 5)),
    row('Короткий перерыв', 'минут', num(t.short, 1, 60, (v) => save((s) => (s.timer.short = v)))),
    row('Длинный перерыв', 'минут', num(t.long, 5, 90, (v) => save((s) => (s.timer.long = v)), 5)),
    row('Длинный перерыв после', 'сеансов фокуса', num(t.longEvery, 2, 10, (v) => save((s) => (s.timer.longEvery = v)))),
    row('Перерыв начинается автоматически', null, toggle(t.autoBreak, (v) => save((s) => (s.timer.autoBreak = v)))),
  );
}

async function dataBlock() {
  const mem = await repo.get('memory');
  const list = h('ul.facts', {}, mem.facts.length ? mem.facts.map((f) => h('li', {}, h('span', {}, f.text), h('button.btn.ghost.small', { onclick: async () => { await repo.update('memory', (m) => { m.facts = m.facts.filter((x) => x.id !== f.id); return m; }); renderSettings(); } }, 'Удалить'))) : h('li.muted', {}, 'Пока ничего. Скажи в чате «запомни, что …» или добавь здесь.'));
  const add = h('input.input', { placeholder: 'Например: я арт-директор, люблю короткие ответы' });
  return block('s-data', '06', 'Память и данные', 'Всё хранится только на этом компьютере в папке приложения. В облако ничего не отправляется.',
    row('Как к тебе обращаться', null, h('input.input', { value: S.userName, style: 'max-width:220px', placeholder: 'Имя', onchange: (e) => save((s) => (s.userName = e.target.value.trim().slice(0, 40))) })),
    h('div.srow', { style: 'flex-direction:column;align-items:stretch' }, h('div.sl', {}, h('b', {}, 'Что маскот знает обо мне'), h('small', {}, 'Эти сведения добавляются в начало каждого разговора с моделью.')), list,
      h('form.row', { onsubmit: async (e) => { e.preventDefault(); if (!add.value.trim()) return; await repo.update('memory', (m) => { m.facts.push({ id: 'f' + Date.now().toString(36), text: add.value.trim(), at: Date.now() }); return m; }); renderSettings(); } }, add, h('button.btn', { type: 'submit' }, 'Добавить'))),
    row('Сохранять историю чата', 'Если выключить, переписка исчезнет после закрытия окна.', toggle(S.chat.saveHistory, async (v) => { await save((s) => (s.chat.saveHistory = v)); if (!v) await repo.put('chat', { messages: [] }); })),
    row('Очистить историю чата', null, h('button.btn', { onclick: async () => { if (await ask('Удалить всю переписку?')) { await clearHistory(); toast('История чата очищена'); } } }, 'Очистить')),
    row('Забыть всё обо мне', 'Удалить все сохранённые сведения о пользователе.', h('button.btn', { onclick: async () => { if (await ask('Удалить все сохранённые сведения?')) { await repo.put('memory', { facts: [] }); await save((s) => (s.userName = '')); renderSettings(); } } }, 'Забыть')),
  );
}

async function systemBlock() {
  const auto = await invoke('autostart_get');
  const u = await invoke('resource_usage');
  try { u.mascot_size = (await (await fetch('assets/mascot/manifest.json')).json()).bytes; } catch { u.mascot_size = 0; }
  const table = h('table.usage', {}, h('tr', {}, h('th', {}, 'Что'), h('th', {}, 'Размер / память')),
    h('tr', {}, h('td', {}, 'Приложение (оболочка, интерфейс, маскот)'), h('td', {}, fmtBytes(u.app_size))),
    h('tr', {}, h('td', {}, '— в том числе ресурсы маскота'), h('td', {}, fmtBytes(u.mascot_size))),
    h('tr', {}, h('td', {}, 'Движок ИИ (llama.cpp)'), h('td', {}, fmtBytes(u.engine_size))),
    h('tr', {}, h('td', {}, 'Скачанные модели'), h('td', {}, fmtBytes(u.models_size))),
    h('tr', {}, h('td', {}, 'Оперативная память: приложение сейчас'), h('td', {}, fmtBytes(u.app_rss))),
    h('tr', {}, h('td', {}, 'Оперативная память: модель ИИ сейчас'), h('td', {}, u.llm_rss ? fmtBytes(u.llm_rss) : 'не загружена')));
  return block('s-system', '07', 'Система и ресурсы', null,
    row('Запускать вместе с компьютером', 'Помощник откроется в компактном режиме. Модель ИИ при этом не загружается.', toggle(auto, async (v) => { await invoke('autostart_set', { enabled: v }); toast(v ? 'Автозапуск включён' : 'Автозапуск выключен'); })),
    h('div', { style: 'margin-top:14px' }, table, h('p.muted', { style: 'font-size:12px' }, 'Память приложения включает процессы веб-интерфейса, которые удалось определить; на macOS системные процессы WebKit учитываются не полностью. ', h('button.btn.ghost.small', { onclick: renderSettings }, 'Обновить'))),
    row('Выйти из приложения', 'Остановит маскота, напоминания и модель.', h('button.btn', { onclick: () => invoke('quit_app') }, 'Выйти')),
  );
}

function aboutBlock() {
  return block('s-about', '08', 'О программе', null,
    h('p', {}, 'I AM — помощник дизайн-студии I AM. Маскот, задачи, таймер и напоминания работают без интернета и без ИИ. Свободное общение — через локальную модель на движке llama.cpp (MIT).'),
    h('p.muted', {}, 'Модели: Qwen3.5 (Apache 2.0, Alibaba), Gemma 4 (Apache 2.0, Google). Шрифты: Montserrat и Pixelify Sans (SIL OFL 1.1). Оболочка: Tauri (MIT/Apache 2.0).'),
  );
}

listen('model-progress', () => { if (!$('#view-settings').hidden) throttledRender(); });
let rt = 0; function throttledRender() { const n = Date.now(); if (n - rt > 700) { rt = n; renderSettings(); } }
