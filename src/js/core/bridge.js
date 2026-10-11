// Мост между интерфейсом и ядром приложения (Tauri).
// В обычном браузере (для разработки и автотестов) работает «заглушка»:
// localStorage вместо файлов, BroadcastChannel вместо событий, LLM по адресу ?llm=http://...
const T = globalThis.__TAURI__;
export const isTauri = !!(T && T.core);

const qs = new URLSearchParams(globalThis.location ? location.search : '');
const bc = !isTauri && globalThis.BroadcastChannel ? new BroadcastChannel('iam') : null;
const localListeners = new Map();
if (bc) bc.onmessage = (e) => (localListeners.get(e.data.name) || []).forEach((f) => f({ payload: e.data.payload }));

export async function invoke(cmd, args = {}) {
  if (isTauri) return T.core.invoke(cmd, args);
  return mock(cmd, args);
}

export async function listen(name, fn) {
  if (isTauri) return T.event.listen(name, fn);
  if (!localListeners.has(name)) localListeners.set(name, []);
  localListeners.get(name).push(fn);
  return () => localListeners.set(name, localListeners.get(name).filter((f) => f !== fn));
}

export async function emit(name, payload) {
  if (isTauri) return T.event.emit(name, payload);   // в Tauri событие получают все окна, включая это
  bc && bc.postMessage({ name, payload });
  (localListeners.get(name) || []).forEach((f) => setTimeout(() => f({ payload }), 0));
}

export function currentWindow() {
  return isTauri ? T.window.getCurrentWindow() : null;
}

// ---------- хранение (JSON-файлы в папке данных приложения) ----------
export async function load(name, fallback) {
  try {
    const raw = await invoke('store_load', { name });
    if (raw == null || raw === '') return structuredClone(fallback);
    return { ...structuredClone(fallback), ...JSON.parse(raw) };
  } catch (e) {
    console.warn('load failed', name, e);
    return structuredClone(fallback);
  }
}
export async function save(name, data) {
  await invoke('store_save', { name, data: JSON.stringify(data) });
  emit('store-changed', { name, from: windowLabel() });
}
export function windowLabel() {
  if (isTauri) return T.window.getCurrentWindow().label;
  return document.body?.dataset.window || 'main';
}

// ---------- потоковый чат с локальной моделью ----------
// onDelta(text) вызывается на каждый фрагмент. Возвращает {cancel, done:Promise}.
export function chatStream(body, onDelta) {
  if (isTauri) {
    const id = Math.random().toString(36).slice(2);
    const ch = new T.core.Channel();
    let resolveDone, rejectDone;
    const done = new Promise((r, j) => { resolveDone = r; rejectDone = j; });
    ch.onmessage = (m) => {
      if (m.type === 'delta') onDelta(m.text);
      else if (m.type === 'done') resolveDone(m.reason || 'stop');
      else if (m.type === 'error') rejectDone(new Error(m.message));
    };
    invoke('llm_chat', { id, body: JSON.stringify(body), onEvent: ch }).catch(rejectDone);
    return { cancel: () => invoke('llm_cancel', { id }), done };
  }
  // браузерный режим: прямой fetch к OpenAI-совместимому серверу (мок в тестах)
  const ctrl = new AbortController();
  const base = qs.get('llm') || 'http://127.0.0.1:8799';
  const done = (async () => {
    const res = await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, stream: true }), signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const d = line.slice(5).trim(); if (d === '[DONE]') return 'stop';
        try { const j = JSON.parse(d); const t = j.choices?.[0]?.delta?.content; if (t) onDelta(t); } catch {}
      }
    }
    return 'stop';
  })().catch((e) => { if (e.name === 'AbortError') return 'cancelled'; throw e; });
  return { cancel: () => ctrl.abort(), done };
}

// ---------- заглушка ядра для браузера ----------
const mockState = { llm: 'stopped', model: null, autostart: false };
async function mock(cmd, a) {
  switch (cmd) {
    case 'store_load': return localStorage.getItem('iam:' + a.name);
    case 'store_save': localStorage.setItem('iam:' + a.name, a.data); return null;
    case 'system_info': return { os: 'browser', arch: 'x64', total_ram: 16 * 2 ** 30, free_disk: 120 * 2 ** 30, cpus: 8 };
    case 'models_installed': return JSON.parse(localStorage.getItem('iam:mock-models') || '[]');
    case 'model_download': {
      const list = JSON.parse(localStorage.getItem('iam:mock-models') || '[]');
      for (let p = 0; p <= 100; p += 20) { await new Promise((r) => setTimeout(r, 60)); emit('model-progress', { id: a.id, received: p / 100 * a.size, total: a.size, state: 'downloading' }); }
      list.push({ id: a.id, file: a.file, size: a.size }); localStorage.setItem('iam:mock-models', JSON.stringify(list));
      emit('model-progress', { id: a.id, received: a.size, total: a.size, state: 'done' });
      return null;
    }
    case 'model_cancel_download': return null;
    case 'model_delete': localStorage.setItem('iam:mock-models', JSON.stringify(JSON.parse(localStorage.getItem('iam:mock-models') || '[]').filter((m) => m.id !== a.id))); return null;
    case 'llm_start': mockState.llm = 'ready'; mockState.file = a.file; return { state: 'ready', port: 8799 };
    case 'llm_stop': mockState.llm = 'stopped'; return null;
    case 'llm_status': return { state: mockState.llm, file: mockState.file, rss: mockState.llm === 'ready' ? 2.1 * 2 ** 30 : 0 };
    case 'resource_usage': return { app_rss: 95 * 2 ** 20, llm_rss: mockState.llm === 'ready' ? 2.1 * 2 ** 30 : 0, app_size: 14 * 2 ** 20, engine_size: 30 * 2 ** 20, models_size: 0 };
    case 'autostart_get': return mockState.autostart;
    case 'autostart_set': mockState.autostart = a.enabled; return null;
    case 'notify': console.log('[notify]', a.title, a.body); return null;
    case 'open_main': window.open('index.html' + (a.tab ? '#' + a.tab : ''), 'iam-main'); return null;
    case 'mascot_set_visible': case 'mascot_set_on_top': case 'mascot_resize': case 'llm_config': case 'quit_app': return null;
    default: console.warn('mock: unknown command', cmd, a); return null;
  }
}
