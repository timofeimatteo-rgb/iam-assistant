// Управление локальной моделью: что установлено, загрузка в память, выгрузка, скачивание.
import { invoke, listen } from '../core/bridge.js';
import { MODELS, byId } from '../core/models.js';
import * as repo from '../core/repo.js';

export const llm = {
  installed: [], status: { state: 'stopped' }, sys: null, downloads: {}, listeners: new Set(),
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  changed() { for (const f of this.listeners) f(this); },

  async refresh() {
    const [inst, st] = await Promise.all([invoke('models_installed'), invoke('llm_status')]);
    this.installed = inst || []; this.status = st || { state: 'stopped' };
    if (!this.sys) this.sys = await invoke('system_info');
    this.changed();
  },
  isInstalled(id) { const m = byId(id); return !!(m && this.installed.some((f) => f.file === m.file)); },
  async active() {
    const s = await repo.get('settings');
    if (s.model.id && this.isInstalled(s.model.id)) return byId(s.model.id);
    const any = MODELS.find((m) => this.isInstalled(m.id));
    return any || null;
  },
  // Запускает модель, если она не запущена. onInfo — сообщение для пользователя о долгой загрузке.
  async ensure(onInfo) {
    const m = await this.active(); if (!m) return null;
    if (this.status.state === 'ready' && this.status.file === m.file) return m;
    const s = await repo.get('settings');
    onInfo && onInfo(`Загружаю модель «${m.name}» в память — первый ответ займёт до 10–40 секунд.`);
    this.status = { state: 'loading', file: m.file }; this.changed();
    try {
      const r = await invoke('llm_start', { file: m.file, args: m.args, accel: s.model.accel, ctx: s.model.ctx, unloadAfter: s.model.unloadAfter });
      this.status = { state: r.state, file: m.file, port: r.port };
    } catch (e) {
      this.status = { state: 'error', error: String(e) }; this.changed(); throw e;
    }
    this.changed(); return m;
  },
  async unload() { await invoke('llm_stop'); this.status = { state: 'stopped' }; this.changed(); },
  async download(m) {
    this.downloads[m.id] = { received: 0, total: m.size, state: 'downloading' }; this.changed();
    try { await invoke('model_download', { id: m.id, url: m.url, file: m.file, size: m.size }); }
    catch (e) { this.downloads[m.id] = { ...this.downloads[m.id], state: 'error', error: String(e) }; this.changed(); throw e; }
  },
  cancelDownload(m) { return invoke('model_cancel_download', { id: m.id }); },
  async remove(m) {
    if (this.status.file === m.file) await this.unload();
    await invoke('model_delete', { file: m.file }); await this.refresh();
  },
};

listen('model-progress', (e) => {
  const p = e.payload; llm.downloads[p.id] = p;
  if (p.state === 'done') { delete llm.downloads[p.id]; llm.refresh(); }
  llm.changed();
});
listen('llm-state', (e) => { llm.status = e.payload; llm.changed(); llm.lastEvent = e.payload; for (const f of llm.listeners) f(llm, e.payload); });
