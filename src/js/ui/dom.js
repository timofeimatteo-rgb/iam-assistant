// Небольшой помощник для создания элементов без innerHTML (тексты пользователя и модели — только как текст).
export function h(tag, attrs = {}, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style') el.style.cssText = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let toastTimer;
export function toast(text, action) {
  document.querySelector('.toast')?.remove();
  const t = h('div.toast', { role: 'status' }, h('span', {}, text), action && h('button', { onclick: () => { action.run(); t.remove(); } }, action.label));
  document.body.append(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), action ? 6000 : 3000);
}

// Собственное окно подтверждения (системный confirm() в WebView работает не везде).
export function ask(text, { ok = 'Да', cancel = 'Отмена' } = {}) {
  return new Promise((resolve) => {
    const close = (v) => { ov.remove(); resolve(v); };
    const okBtn = h('button.btn.primary', { onclick: () => close(true) }, ok);
    const ov = h('div.overlay', { style: 'z-index:70', onkeydown: (e) => { if (e.key === 'Escape') close(false); } },
      h('div.modal', { role: 'dialog', 'aria-modal': 'true' }, h('p', { style: 'margin:0 0 18px;font-size:15px' }, text),
        h('div.row', { style: 'justify-content:flex-end' }, h('button.btn', { onclick: () => close(false) }, cancel), okBtn)));
    document.body.append(ov); okBtn.focus();
  });
}
