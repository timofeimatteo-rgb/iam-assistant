// Рабочее окно: чат, задачи, текущая задача, таймер, настройки.
import { listen } from './core/bridge.js';
import * as repo from './core/repo.js';
import { initChat, breakdown } from './main/chat.js';
import { initWork } from './main/work.js';
import { renderSettings } from './main/settings.js';
import { runWelcome } from './main/welcome.js';
import { llm } from './main/llmctl.js';
import { $, $$ } from './ui/dom.js';
import { dndActive, hm } from './core/time.js';

function showTab(tab, anchor) {
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  $('#view-work').hidden = tab !== 'work'; $('#view-settings').hidden = tab !== 'settings';
  if (tab === 'settings') renderSettings().then(() => anchor && document.getElementById(anchor)?.scrollIntoView());
}
const gotoSettings = (anchor) => showTab('settings', anchor);

// переход по вкладкам из маскота/трея: #chat, #tasks, #settings, #welcome
async function route(tab) {
  tab = (tab || '').replace('#', '');
  if (tab === 'settings') showTab('settings');
  else if (tab === 'welcome') { showTab('work'); runWelcome(); }
  else { showTab('work'); if (tab === 'tasks') $('#taskInput').focus(); else $('#chatInput').focus(); }
}

async function renderChips() {
  const s = await repo.get('settings');
  const dnd = dndActive(s);
  $('#dndChip').classList.toggle('on', dnd);
  $('#dndChip span').textContent = dnd ? `до ${hm(s.dnd.until)}` : '';
  $('#dndChip').title = dnd ? `Не беспокоить до ${hm(s.dnd.until)} — нажмите, чтобы выключить` : 'Не беспокоить 1 час';
  const st = llm.status || {}; const m = await llm.active();
  const chip = $('#llmChip'); chip.className = 'model-pill ' + (st.state === 'ready' ? 'ready' : st.state === 'loading' ? 'busy' : '');
  $('#llmChip span').textContent = !m ? 'I AM · без модели ИИ' : `I AM · ${m.name}`;
  chip.title = !m ? 'Модель ИИ не скачана' : st.state === 'ready' ? 'Модель загружена в память' : st.state === 'loading' ? 'Модель загружается…' : 'Модель не в памяти — загрузится при первом сообщении';
}

async function main() {
  for (const b of $$('.tabs button')) b.onclick = () => showTab(b.dataset.tab);
  $('#dndChip').onclick = async () => { await repo.update('settings', (s) => { s.dnd = { until: dndActive(s) ? 0 : Date.now() + 3600_000 }; return s; }); renderChips(); };
  $('#llmChip').onclick = () => gotoSettings('s-model');
  const side = (v) => { document.querySelector('.app').classList.toggle('side-hidden', !v); $('#sideOpen').hidden = v; };
  $('#sideClose').onclick = () => side(false); $('#sideOpen').onclick = () => side(true);
  if (innerWidth < 760) side(false);
  await initChat({ gotoSettings });
  await initWork({ breakdown: (t) => { showTab('work'); breakdown(t); } });
  llm.onChange(renderChips); await llm.refresh().catch(() => {}); renderChips();
  listen('store-changed', (e) => { if (e.payload.name === 'settings') renderChips(); });
  listen('navigate', (e) => route(e.payload.tab));
  setInterval(renderChips, 30000);
  const s = await repo.get('settings');
  route(s.firstRunDone ? (window.__IAM_TAB || location.hash) : 'welcome');
}
main();
