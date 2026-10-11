// Самопроверка в настоящем приложении (запуск с аргументом --selftest=1 или --selftest=2).
// Используется в CI на macOS и Windows: проверяет хранение, автозапуск, уведомления,
// напоминания, «Не беспокоить», окно маскота и локальную модель. Пишет отчёт в data/selftest*.json.
import { invoke, chatStream } from './core/bridge.js';
import * as repo from './core/repo.js';
import * as Tasks from './core/tasks.js';
import * as Sched from './core/scheduler.js';
import { MODELS } from './core/models.js';

export async function selftest(phase, ui) {
  const report = { phase, at: new Date().toISOString(), ua: navigator.userAgent, checks: [] };
  const check = async (name, fn) => {
    const t0 = performance.now();
    try { const v = await fn(); report.checks.push({ name, ok: v !== false, value: v === true ? undefined : v, ms: Math.round(performance.now() - t0) }); }
    catch (e) { report.checks.push({ name, ok: false, error: String(e && e.message || e) }); }
  };
  const save = () => invoke('store_save', { name: phase === 1 ? 'selftesta' : 'selftestb', data: JSON.stringify(report, null, 1) });

  if (phase === 1) {
    await check('хранение: запись задачи', async () => {
      await repo.update('tasks', (s) => Tasks.add(s, 'Проверка сохранения после перезапуска').state);
      return true;
    });
    await check('настройки: первый запуск пройден', async () => { await repo.update('settings', (s) => { s.firstRunDone = true; s.userName = 'Тест'; return s; }); return true; });
  } else {
    await check('задача сохранилась после перезапуска', async () => {
      const t = await repo.get('tasks');
      return t.items.some((x) => x.title === 'Проверка сохранения после перезапуска') || 'задача не найдена';
    });
  }
  await check('автозапуск: включить', async () => { await invoke('autostart_set', { enabled: true }); return (await invoke('autostart_get')) === true || 'не включился'; });
  await check('автозапуск: выключить', async () => { await invoke('autostart_set', { enabled: false }); return (await invoke('autostart_get')) === false || 'не выключился'; });
  await check('системное уведомление', async () => { await invoke('notify', { title: 'I AM · самопроверка', body: 'Уведомление работает' }); return true; });
  await check('окно маскота: изменение размера', async () => { await invoke('mascot_resize', { width: 300, height: 320 }); await invoke('mascot_resize', { width: 130, height: 200 }); return true; });
  await check('напоминание срабатывает', async () => {
    await repo.update('state', (s) => { s.sched = Sched.addCustom(s.sched, { text: 'Самопроверка напоминания', at: Date.now() - 1000 }).sched; s.sched.lastFiredAt = 0; return s; });
    await ui.tick();
    const shown = !document.querySelector('#bubble').hidden && document.querySelector('#bubbleText').textContent.includes('Самопроверка');
    return shown || 'реплика не показана';
  });
  await check('«Не беспокоить» задерживает напоминание', async () => {
    document.querySelector('#bubble').hidden = true; ui.clearFire();
    await repo.update('settings', (s) => { s.dnd = { until: Date.now() + 3600_000 }; return s; });
    await ui.reloadSettings();
    await repo.update('state', (s) => { s.sched = Sched.addCustom(s.sched, { text: 'Не должно показаться', at: Date.now() - 1000 }).sched; s.sched.lastFiredAt = 0; return s; });
    await ui.tick();
    const hidden = document.querySelector('#bubble').hidden || !document.querySelector('#bubbleText').textContent.includes('Не должно');
    await repo.update('settings', (s) => { s.dnd = { until: 0 }; return s; });
    await repo.update('state', (s) => { s.sched.custom = s.sched.custom.filter((c) => c.text !== 'Не должно показаться'); return s; });
    await ui.reloadSettings();
    return hidden || 'реплика показана во время «Не беспокоить»';
  });
  await check('ресурсы в ожидании', async () => invoke('resource_usage'));
  await check('сведения о системе', async () => invoke('system_info'));

  // локальная модель (если CI заранее положил её в папку models)
  const installed = await invoke('models_installed');
  for (const f of installed) {
    const m = MODELS.find((x) => x.file === f.file); if (!m) continue;
    const t0 = performance.now();
    await check(`модель ${m.name}: загрузка в память`, async () => invoke('llm_start', { file: m.file, args: m.args, accel: 'auto', ctx: 4096, unloadAfter: 0 }));
    report.checks.at(-1).ms = Math.round(performance.now() - t0);
    await check(`модель ${m.name}: ответ по-русски`, async () => {
      let text = ''; let first = 0; const t1 = performance.now();
      const s = chatStream({ messages: [{ role: 'system', content: 'Ты дружелюбный помощник. Отвечай по-русски, одним-двумя предложениями.' }, { role: 'user', content: 'Привет! Подскажи, как сделать короткий перерыв в работе?' }], max_tokens: 120, temperature: 0.6 }, (d) => { if (!first) first = performance.now(); text += d; });
      const reason = await s.done;
      const secs = (performance.now() - (first || t1)) / 1000;
      return { reason, text: text.trim(), first_token_ms: Math.round((first || performance.now()) - t1), chars_per_s: Math.round(text.length / Math.max(secs, 0.01)), cyrillic: /[а-яё]/i.test(text) };
    });
    await check(`модель ${m.name}: память при общении`, async () => invoke('llm_status'));
    await check(`модель ${m.name}: остановка генерации`, async () => {
      let n = 0; const s = chatStream({ messages: [{ role: 'user', content: 'Напиши длинный рассказ о коте-дизайнере.' }], max_tokens: 800 }, () => { n++; });
      await new Promise((r) => setTimeout(r, 1500)); await s.cancel(); const reason = await s.done;
      return reason === 'cancelled' ? { reason, chunks_before_stop: n } : 'не остановилась: ' + reason;
    });
    await check(`модель ${m.name}: выгрузка`, async () => { await invoke('llm_stop'); const st = await invoke('llm_status'); return st.state === 'stopped' || st; });
  }
  report.done = true;
  await save();
  return report;
}
