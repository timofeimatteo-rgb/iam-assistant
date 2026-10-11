// Мастер первого запуска: имя → модель ИИ → автозапуск → рабочие часы.
import * as repo from '../core/repo.js';
import { invoke, emit } from '../core/bridge.js';
import { MODELS, recommend, fits, diskNeeded } from '../core/models.js';
import { llm } from './llmctl.js';
import { h, $, toast } from '../ui/dom.js';
import { fmtBytes } from '../core/time.js';

export async function runWelcome(onDone) {
  const S = await repo.get('settings');
  await llm.refresh();
  const sys = llm.sys || {};
  const ov = $('#welcome'); ov.hidden = false;
  const body = $('#wizBody'); const title = $('#wizTitle');
  const data = { name: S.userName, model: recommend(sys.total_ram), autostart: true };

  const step = (n, label, ...kids) => { title.textContent = `Шаг ${n} из 4 · ${label}`; body.replaceChildren(...kids); body.querySelector('input,button.primary')?.focus(); };
  const btns = (...b) => h('div.wiz-btns', {}, ...b);

  function s1() {
    const name = h('input.input', { value: data.name, placeholder: 'Например, Тимофей', maxlength: 40 });
    step(1, 'Знакомство',
      h('img', { src: 'assets/mascot-full.png', alt: '', style: 'height:120px;width:auto;margin-bottom:6px;display:block' }), h('h1', {}, 'Привет! Я напарник I AM'),
      h('p.lead', {}, 'Помогаю начать работу, держу список задач, слежу за таймером фокуса и напоминаю про воду, глаза и зарядку. Всё работает на этом компьютере.'),
      h('div.field', {}, h('label.label', {}, 'Как к вам обращаться?'), name),
      btns(h('button.btn.primary', { onclick: () => { data.name = name.value.trim(); s2(); } }, 'Дальше')));
  }

  function s2() {
    const opts = [...MODELS.map((m) => ({ m })), { m: null }];
    const list = h('div.choice', { role: 'radiogroup' });
    for (const { m } of opts) {
      const id = m ? m.id : 'none'; const sel = data.model === id;
      const warn = m && !fits(m, sys.total_ram);
      const noDisk = m && sys.free_disk && sys.free_disk < diskNeeded(m);
      list.append(h('label.opt', { class: sel ? 'sel' : '' },
        h('input', { type: 'radio', name: 'model', checked: sel, disabled: !!noDisk, onchange: () => { data.model = id; s2(); } }),
        h('div', {}, h('b', {}, m ? `${m.tier} · ${m.name}` : 'Пока без ИИ'), m && m.id === recommend(sys.total_ram) && h('span.rec', {}, 'рекомендуем'),
          h('div.specs', {}, m ? `Скачать ${fmtBytes(m.size)} · на диске ${fmtBytes(diskNeeded(m))} · память при общении ≈ ${fmtBytes(m.ramChat)} · нужно ОЗУ от ${fmtBytes(m.minRam)}` : 'Задачи, таймер, напоминания и маскот работают и так. Модель можно скачать позже в настройках.'),
          m && h('div.specs', {}, m.note),
          warn && h('div.specs', { style: 'color:var(--red)' }, 'Для этого компьютера тяжеловата.'),
          noDisk && h('div.specs', { style: 'color:var(--red)' }, 'Не хватает места на диске.'))));
    }
    step(2, 'Модель ИИ',
      h('h1', {}, 'Локальный ИИ'),
      h('p.lead', {}, `Для свободного общения нужна языковая модель. Она скачивается один раз (нужен интернет), потом работает без сети, бесплатно и без отправки переписки куда-либо. На этом компьютере ${sys.total_ram ? fmtBytes(sys.total_ram) + ' оперативной памяти' : 'объём памяти неизвестен'}${sys.free_disk ? ', свободно ' + fmtBytes(sys.free_disk) + ' на диске' : ''}.`),
      list,
      btns(h('button.btn', { onclick: s1 }, 'Назад'), h('button.btn.primary', { onclick: s3 }, data.model === 'none' ? 'Дальше' : 'Скачать и дальше')));
  }

  function startDownload() {
    const m = MODELS.find((x) => x.id === data.model); if (!m || llm.isInstalled(m.id)) return;
    repo.update('settings', (s) => { s.model.id = m.id; return s; });
    llm.download(m).then(() => { toast(`Модель «${m.name}» скачана — можно общаться.`); emit('mascot-play', { anim: 'joy', text: 'Модель на месте. Поболтаем?' }); })
      .catch((e) => toast('Загрузка модели прервалась: ' + e + '. Продолжить можно в настройках.'));
  }

  function s3() {
    startDownload();
    step(3, 'Автозапуск',
      h('h1', {}, 'Запускать вместе с компьютером?'),
      h('p.lead', {}, 'Маскот появится на рабочем столе в компактном режиме. Задачи и напоминания будут доступны сразу, а модель ИИ загрузится только когда вы откроете чат. Выключить можно в настройках.'),
      data.model !== 'none' && h('p.muted', {}, 'Модель скачивается в фоне — прогресс виден в «Настройки → Модель ИИ».'),
      btns(h('button.btn', { onclick: () => { data.autostart = false; s4(); } }, 'Не нужно'), h('button.btn.primary', { onclick: () => { data.autostart = true; s4(); } }, 'Да, включить')));
  }

  function s4() {
    const st = h('input.input.short', { type: 'time', value: S.workHours.start });
    const en = h('input.input.short', { type: 'time', value: S.workHours.end });
    const rem = {}; const names = { eyes: 'отдых для глаз', water: 'вода', rest: 'перерыв', exercise: 'зарядка' };
    const list = h('div.row.wrap', {}, Object.keys(names).map((k) => { rem[k] = h('input', { type: 'checkbox', checked: S.reminders[k].enabled }); return h('label.row', { style: 'gap:6px' }, rem[k], names[k]); }));
    step(4, 'Ритм работы',
      h('h1', {}, 'Рабочие часы'),
      h('p.lead', {}, 'Вне рабочего времени маскот молчит и не напоминает. Всё это потом меняется в настройках.'),
      h('div.row', {}, h('span', {}, 'С'), st, h('span', {}, 'до'), en),
      h('p.label', { style: 'margin:18px 0 8px' }, 'Напоминания'), list,
      btns(h('button.btn', { onclick: s3 }, 'Назад'), h('button.btn.primary', { onclick: finish }, 'Готово')));
    async function finish() {
      try { await invoke('autostart_set', { enabled: data.autostart }); } catch (e) { toast('Не удалось включить автозапуск: ' + e); }
      await repo.update('settings', (s) => {
        s.userName = data.name; s.firstRunDone = true;
        s.workHours.start = st.value || s.workHours.start; s.workHours.end = en.value || s.workHours.end;
        for (const k of Object.keys(rem)) s.reminders[k].enabled = rem[k].checked;
        return s;
      });
      ov.hidden = true;
      emit('mascot-play', { anim: 'greet', text: `Готово${data.name ? ', ' + data.name : ''}! Я тут, если что — просто нажми на меня.`, important: true, ttl: 8000 });
      onDone && onDone();
    }
  }
  s1();
}
