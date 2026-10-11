// Настройки и данные по умолчанию.
export const DEFAULT_SETTINGS = {
  version: 1,
  firstRunDone: false,
  userName: '',
  // инициативность маскота: 0 — молчит, 1 — редко, 2 — обычно, 3 — часто
  initiative: 2,
  messagesEnabled: true,
  sound: false,
  animations: 'full',           // full | reduced | off
  mascotScale: 1,               // 0.7 … 1.4
  onTop: true,
  mascotVisible: true,
  workHours: { enabled: true, start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  dnd: { until: 0 },
  holdDuringFocus: true,        // не прерывать сеанс фокуса напоминаниями
  reminders: {
    eyes:     { enabled: true, every: 40 },
    water:    { enabled: true, every: 75 },
    rest:     { enabled: true, every: 60 },
    exercise: { enabled: true, every: 120 },
  },
  timer: { focus: 25, short: 5, long: 15, longEvery: 4, autoBreak: true },
  model: { id: null, accel: 'auto', unloadAfter: 10, ctx: 4096 },
  chat: { saveHistory: true },
};

export const DEFAULT_TASKS = { items: [], currentId: null };
export const DEFAULT_STATE = {              // служебное состояние (таймер, расписание напоминаний, статистика)
  timer: { phase: 'idle', running: false, endsAt: 0, remaining: 0, cycle: 0 },
  sched: { next: {}, custom: [], lastFiredAt: 0, lastPokeAt: 0, greetedDay: '' },
  stats: {},                                 // { 'YYYY-MM-DD': { focus: n, tasks: n } }
};
export const DEFAULT_CHAT = { messages: [] };
export const DEFAULT_MEMORY = { facts: [] };  // сведения о пользователе, которые он сам разрешил хранить

export const REMINDER_INFO = {
  eyes:     { title: 'Отдых для глаз', anim: 'break', text: 'Посмотри вдаль секунд двадцать — глазам приятно.' },
  water:    { title: 'Вода', anim: 'greet', text: 'Глоток воды?' },
  rest:     { title: 'Перерыв', anim: 'break', text: 'Встань, потянись, пройдись пару минут.' },
  exercise: { title: 'Зарядка', anim: 'exercise', text: 'Две минуты зарядки — и снова в бой.' },
};
