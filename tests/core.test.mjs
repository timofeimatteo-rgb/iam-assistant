import test from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../src/js/core/intents.js';
import * as S from '../src/js/core/scheduler.js';
import * as Tm from '../src/js/core/timer.js';
import * as Tk from '../src/js/core/tasks.js';
import * as L from '../src/js/core/llm.js';
import { inWorkHours, MIN } from '../src/js/core/time.js';
import { DEFAULT_SETTINGS, DEFAULT_TASKS, DEFAULT_STATE } from '../src/js/core/defaults.js';

const at = (h, m = 0, day = 13) => new Date(2026, 9, day, h, m).getTime(); // 13.10.2026 — вторник
const S0 = structuredClone(DEFAULT_SETTINGS);

test('напоминание через N минут', () => {
  const r = I.parse('напомни через 15 минут позвонить маме', at(10));
  assert.equal(r.type, 'reminder'); assert.equal(r.at, at(10, 15)); assert.equal(r.text, 'Позвонить маме');
});
test('напоминание через полчаса / через час / словами', () => {
  assert.equal(I.parse('Напомни мне через полчаса выпить таблетку', at(10)).at, at(10, 30));
  assert.equal(I.parse('напомни через час про созвон', at(10)).at, at(11));
  const r = I.parse('напомни через пять минут проверить почту', at(10)); assert.equal(r.at, at(10, 5)); assert.equal(r.text, 'Проверить почту');
});
test('напоминание на время', () => {
  const r = I.parse('напомни в 15:30 отправить макет клиенту', at(10));
  assert.equal(r.at, at(15, 30)); assert.equal(r.text, 'Отправить макет клиенту');
  const r2 = I.parse('напомни отправить счёт в 9:00', at(10)); assert.equal(r2.at, at(9, 0, 14)); assert.equal(r2.text, 'Отправить счёт');
  const r3 = I.parse('напомни завтра в 10 утра купить корм коту', at(20)); assert.equal(r3.at, at(10, 0, 14)); assert.equal(r3.text, 'Купить корм коту');
  const r4 = I.parse('напомни в 3 созвон', at(10)); assert.equal(r4.at, at(15));
});
test('напоминание без времени требует уточнения', () => {
  assert.equal(I.parse('напомни позвонить маме', at(10)).type, 'reminderNeedsTime');
});
test('команды задач, таймера, режима', () => {
  assert.deepEqual(I.parse('добавь задачу сверстать лендинг'), { type: 'addTask', title: 'Сверстать лендинг' });
  assert.equal(I.parse('Разбей задачу подготовить презентацию на шаги').title, 'Подготовить презентацию');
  assert.equal(I.parse('я сделал логотип').type, 'completeTask');
  assert.deepEqual(I.parse('запусти таймер на 50 минут'), { type: 'timerStart', minutes: 50 });
  assert.equal(I.parse('не беспокой 2 часа').ms, 2 * 60 * MIN);
  assert.equal(I.parse('станцуй!').type, 'dance');
  assert.equal(I.parse('как сделать хороший логотип?'), null);
});

test('рабочие часы', () => {
  assert.equal(inWorkHours(S0.workHours, at(10)), true);
  assert.equal(inWorkHours(S0.workHours, at(19)), false);
  assert.equal(inWorkHours(S0.workHours, at(10, 0, 18)), false); // воскресенье
});

test('периодическое напоминание срабатывает и откладывается', () => {
  let sched = S.normalize(DEFAULT_STATE.sched, S0, at(9));
  let r = S.tick(sched, S0, {}, at(9, 30)); assert.equal(r.fire, null);
  r = S.tick(r.sched, S0, {}, at(9, 41)); assert.equal(r.fire.key, 'eyes');
  const after = S.respond(r.sched, S0, r.fire, 'snooze', at(9, 41));
  assert.equal(after.next.eyes, at(9, 51));
});
test('не беспокоить и фокус задерживают периодические напоминания', () => {
  const s = { ...S0, dnd: { until: at(11) } };
  let sched = S.normalize(DEFAULT_STATE.sched, s, at(9));
  assert.equal(S.tick(sched, s, {}, at(10)).fire, null);
  assert.equal(S.tick(sched, S0, { focusRunning: true }, at(10)).fire, null);
  assert.ok(S.tick(sched, S0, { focusRunning: false }, at(10)).fire);
});
test('вне рабочих часов напоминания не копятся', () => {
  let sched = S.normalize(DEFAULT_STATE.sched, S0, at(17, 50));
  const r = S.tick(sched, S0, {}, at(19)); assert.equal(r.fire, null);
  assert.ok(r.sched.next.eyes > at(19));
});
test('разовое напоминание ждёт окончания «Не беспокоить»', () => {
  let { sched } = S.addCustom(DEFAULT_STATE.sched, { text: 'Созвон', at: at(10) }, at(9));
  const s = { ...S0, dnd: { until: at(10, 30) }, reminders: {} };
  assert.equal(S.tick(sched, s, {}, at(10, 5)).fire, null);
  const r = S.tick(sched, s, {}, at(10, 31)); assert.equal(r.fire.text, 'Созвон'); assert.equal(r.fire.late, true);
  assert.equal(S.tick(r.sched, s, {}, at(10, 40)).fire, null); // второй раз не срабатывает
});
test('отключённое напоминание не срабатывает', () => {
  const s = structuredClone(S0); s.reminders.eyes.enabled = false;
  const sched = S.normalize(DEFAULT_STATE.sched, s, at(9));
  assert.equal(sched.next.eyes, undefined);
});

test('таймер: фокус → короткий перерыв → длинный', () => {
  const cfg = S0.timer; let t = Tm.start(DEFAULT_STATE.timer, cfg, 'focus', at(10));
  let r = Tm.tick(t, cfg, at(10, 24)); assert.equal(r.event, null);
  r = Tm.tick(t, cfg, at(10, 25)); assert.equal(r.event.type, 'focusDone'); assert.equal(r.timer.phase, 'short');
  t = Tm.pause(r.timer, at(10, 27)); assert.equal(Tm.left(t, at(10, 40)), 3 * MIN);
  t = Tm.resume(t, at(10, 40)); assert.equal(t.endsAt, at(10, 43));
  let t4 = { ...Tm.start(DEFAULT_STATE.timer, cfg, 'focus', at(10)), cycle: 3 };
  assert.equal(Tm.tick(t4, cfg, at(11)).timer.phase, 'long');
});

test('задачи: добавление, выполнение, перенос, поиск', () => {
  let st = structuredClone(DEFAULT_TASKS);
  ({ state: st } = Tk.add(st, 'Сверстать лендинг', { now: at(10, 0, 12) }));
  ({ state: st } = Tk.add(st, 'Позвонить клиенту', { now: at(10) }));
  assert.equal(Tk.today(st, at(11)).length, 2);  // вчерашняя незавершённая «переехала»
  const f = Tk.find(st, 'я сверстал лендинг', at(11)); assert.equal(f.title, 'Сверстать лендинг');
  ({ state: st } = Tk.toggle(st, f.id, at(11)));
  assert.equal(Tk.today(st, at(11)).filter((t) => t.done).length, 1);
  assert.equal(Tk.today(st, at(11, 0, 14)).length, 1); // на следующий день выполненная вчерашняя скрыта
});

test('метки действий из ответа модели', () => {
  const r = L.extractActions('Отличная идея!\n[[напомнить через: 20 | Проверить почту]]\n[[задача: Сделать бриф]]', at(10));
  assert.equal(r.text, 'Отличная идея!'); assert.equal(r.actions.length, 2);
  assert.equal(r.actions[0].at, at(10, 20)); assert.equal(r.actions[1].title, 'Сделать бриф');
  assert.equal(L.extractActions('Текст [[напом', at(10)).text, 'Текст');
  assert.deepEqual(L.extractActions('[[шаги: Открыть файл; Собрать референсы; Сделать эскиз]]').actions[0].steps.length, 3);
});
test('защита от ложных «поставил напоминание»', () => {
  const g = L.guardClaims('Конечно! Я поставил напоминание на 15:00. Удачи!', false);
  assert.equal(g.flagged, true); assert.ok(!/поставил/.test(g.text)); assert.ok(/Удачи/.test(g.text));
  const g2 = L.guardClaims('Готово, добавил задачу в список.', true); assert.ok(/подтвердите/.test(g2.text));
  const g3 = L.guardClaims('Ты добавил задачу — это здорово!', false); assert.equal(g3.flagged, false);
});
test('разбор шагов', () => {
  assert.deepEqual(L.parseSteps('Вот шаги:\n1. Открыть бриф\n2) **Собрать** референсы\n- Сделать эскиз'), ['Открыть бриф', 'Собрать референсы', 'Сделать эскиз']);
});
