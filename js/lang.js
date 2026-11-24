// Language switcher. Reloads so every view is rebuilt in the chosen language.
import { h } from './dom.js';
import { t, getLang, setLang } from './i18n.js';

export function langControl() {
  const sel = h('select', { class: 'lang-select', 'aria-label': t('lang.label') },
    ['ar', 'en'].map((l) => h('option', { value: l, selected: l === getLang() }, t(`lang.${l}`))));
  sel.addEventListener('change', () => { setLang(sel.value); location.reload(); });
  return h('div', { class: 'item' }, h('span', { class: 'muted' }, t('lang.label')), sel);
}
