// Theme: light / dark / follow the device. Stored per browser; applied before first paint by initTheme().
import { h } from './dom.js';
import { t } from './i18n.js';

const KEY = 'club.theme';
export function getTheme() { try { return localStorage.getItem(KEY) || 'auto'; } catch (_) { return 'auto'; } }
export function applyTheme(v) {
  const el = document.documentElement;
  if (v === 'light' || v === 'dark') el.setAttribute('data-theme', v); else el.removeAttribute('data-theme');
  try { const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', v === 'dark' ? '#0a0f16' : '#0f766e'); } catch (_) { /* optional */ }
}
export function initTheme() { applyTheme(getTheme()); }
export function themeControl() {
  const sel = h('select', { class: 'lang-select', 'aria-label': t('theme.label') },
    ['auto', 'light', 'dark'].map((v) => h('option', { value: v, selected: v === getTheme() }, t(`theme.${v}`))));
  sel.addEventListener('change', () => { try { localStorage.setItem(KEY, sel.value); } catch (_) { /* ignore */ } applyTheme(sel.value); });
  return h('div', { class: 'item' }, h('span', { class: 'muted' }, t('theme.label')), sel);
}
