// Small DOM helpers. Everything is built with textContent / text nodes: never innerHTML with data.
import { t, locale } from './i18n.js';
import { CURRENCY_DECIMALS, DEFAULT_DECIMALS } from './config.js';

export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') e[k] = v;
      else e.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export function spinner() { return h('div', { class: 'spinner', role: 'status' }, t('app.loading')); }

export function toast(message, kind = 'info') {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(host); }
  const el = h('div', { class: `toast ${kind}` }, message);
  host.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3000);
}

export function errText(e) {
  const m = String((e && e.message) || e || '');
  if (/MFA required/i.test(m) || /aal2/i.test(m)) return t('err.mfa');
  if (/throttl|too many/i.test(m)) return t('err.throttled');
  if (/member_limit_reached/.test(m)) return t('err.memberLimit');
  if (/branch_limit_reached/.test(m)) return t('err.branchLimit');
  if (/trial_expired|subscription_suspended/.test(m)) return t(`sub.${m.match(/trial_expired|subscription_suspended/)[0]}`);
  if (/not allowed|permission denied|row-level security|42501/i.test(m)) return t('err.denied');
  return `${t('err.generic')}: ${m}`.slice(0, 240);
}

export async function guard(fn) {
  try { return await fn(); } catch (e) { toast(errText(e), 'error'); return undefined; }
}

// ---------- formatting ----------
export function decimals(cur) { return CURRENCY_DECIMALS[cur] ?? DEFAULT_DECIMALS; }

export function fmtMoney(minor, cur) {
  const d = decimals(cur);
  const n = Number(minor) / 10 ** d;
  return `${n.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d })} ${cur}`;
}

export function toMinor(text, cur) {
  const n = Number(String(text).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const v = Math.round(n * 10 ** decimals(cur));
  return Number.isSafeInteger(v) ? v : null;
}

export function fmtDate(d) {
  if (!d) return t('common.none');
  return new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(d) {
  if (!d) return t('common.none');
  return new Date(d).toLocaleString(locale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Last day of the month of an ISO date (YYYY-MM-DD).
export function endOfMonth(isoDate) {
  const [y, m] = isoDate.split('-').map(Number);
  const d = new Date(y, m, 0); // day 0 of next month = last day of this month
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- modal form ----------
// fields: [{ name, label, type: text|number|date|datetime-local|select|textarea|email|tel, options:[{value,label}], required, value, placeholder, maxlength, min, step }]
export function openForm({ title, fields, submitLabel, onSubmit }) {
  return new Promise((resolve) => {
    const inputs = {};
    const form = h('form', { class: 'form', novalidate: true });
    for (const f of fields) {
      let input;
      if (f.type === 'select') {
        input = h('select', { name: f.name, required: f.required }, (f.options || []).map((o) => h('option', { value: o.value, selected: String(o.value) === String(f.value ?? '') }, o.label)));
      } else if (f.type === 'textarea') {
        input = h('textarea', { name: f.name, rows: 3, maxlength: f.maxlength, required: f.required, placeholder: f.placeholder }, f.value ?? '');
      } else {
        input = h('input', { name: f.name, type: f.type || 'text', required: f.required, value: f.value ?? '', placeholder: f.placeholder, maxlength: f.maxlength, min: f.min, step: f.step, autocomplete: 'off', inputmode: f.inputmode, dir: f.dir });
      }
      inputs[f.name] = input;
      form.append(h('label', { class: 'field' }, h('span', null, f.label), input));
    }
    const err = h('div', { class: 'form-error', role: 'alert' });
    const submit = h('button', { type: 'submit', class: 'btn primary' }, submitLabel || t('common.save'));
    const cancel = h('button', { type: 'button', class: 'btn' }, t('common.cancel'));
    form.append(err, h('div', { class: 'row end' }, cancel, submit));

    const overlay = h('div', { class: 'overlay' }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', null, title), form));
    const close = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    cancel.addEventListener('click', () => close(null));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.textContent = '';
      const values = {};
      for (const f of fields) {
        const el = inputs[f.name];
        const v = el.value.trim();
        if (f.required && !v) { err.textContent = `${f.label}: ${t('err.invalid')}`; el.focus(); return; }
        values[f.name] = v;
      }
      submit.disabled = true;
      try {
        const res = await onSubmit(values);
        if (res === false) { submit.disabled = false; return; }
        close(true);
      } catch (e) {
        err.textContent = errText(e);
        submit.disabled = false;
      }
    });
    document.body.append(overlay);
    const first = form.querySelector('input,select,textarea');
    if (first) first.focus();
  });
}

export function confirmBox(message) {
  return new Promise((resolve) => {
    const ok = h('button', { class: 'btn primary', type: 'button' }, t('common.yes'));
    const no = h('button', { class: 'btn', type: 'button' }, t('common.cancel'));
    const overlay = h('div', { class: 'overlay' }, h('div', { class: 'modal small', role: 'alertdialog', 'aria-modal': 'true' }, h('p', null, message), h('div', { class: 'row end' }, no, ok)));
    const done = (v) => { overlay.remove(); resolve(v); };
    ok.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
    document.body.append(overlay);
    ok.focus();
  });
}

export function badge(text, kind = '') { return h('span', { class: `badge ${kind}` }, text); }

export function button(label, onClick, cls = 'btn') { return h('button', { type: 'button', class: cls, onClick }, label); }
