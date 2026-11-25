// Club identity (owner): accent colour from the palette the platform allows, and the club logo.
import { sb } from '../supa.js';
import { state } from '../state.js';
import { h, button, toast, guard } from '../dom.js';
import { t } from '../i18n.js';
import { applyBrand, brandingOptions, contrastWithWhite, logoImg } from '../brand.js';
import { uploadClubLogo, removeClubLogo } from '../photo.js';

export async function brandingSection() {
  const opt = await brandingOptions();
  const box = h('div', null);

  async function setColor(color) {
    const { error } = await sb.rpc('set_club_color', { p_club: state.club.id, p_color: color });
    if (error) throw error;
    state.club.brand_color = color; applyBrand(state.club);
    toast(t('brand.saved'), 'ok'); draw();
  }
  async function setLogo(fn) {
    await fn();
    toast(t('brand.saved'), 'ok');
    const { data } = await sb.from('clubs').select('logo_path').eq('id', state.club.id).single();
    state.club.logo_path = data ? data.logo_path : null; draw();
  }
  function pickImage() {
    return new Promise((resolve) => {
      const i = h('input', { type: 'file', accept: 'image/*' });
      i.addEventListener('change', () => resolve(i.files && i.files[0] ? i.files[0] : null));
      i.addEventListener('cancel', () => resolve(null));
      i.click();
    });
  }

  function draw() {
    box.replaceChildren();
    const cur = (state.club.brand_color || '').toLowerCase();
    const swatches = h('div', { class: 'swatches', role: 'group', 'aria-label': t('brand.color') });
    for (const c of opt.palette || []) {
      const sw = h('button', { type: 'button', class: `swatch${c === cur ? ' sel' : ''}`, 'aria-label': c, 'aria-pressed': String(c === cur), onClick: () => guard(() => setColor(c)) });
      sw.style.background = c; // CSSOM assignment is allowed by the CSP (inline style attributes are not)
      swatches.append(sw);
    }
    box.append(h('h3', { class: 'section' }, t('brand.title')), h('p', { class: 'muted small' }, t('brand.help')), swatches);
    const row = h('div', { class: 'row gap wrap' });
    if (opt.allow_custom) {
      const input = h('input', { type: 'color', value: cur || '#0d9488', 'aria-label': t('brand.custom') });
      row.append(h('label', { class: 'row gap' }, h('span', { class: 'muted' }, t('brand.custom')), input),
        button(t('brand.apply'), () => guard(async () => {
          if (contrastWithWhite(input.value) < 3.5) throw new Error(t('brand.tooLight'));
          await setColor(input.value.toLowerCase());
        }), 'btn small'));
    }
    if (cur) row.append(button(t('brand.reset'), () => guard(() => setColor(null)), 'btn small ghost'));
    box.append(row);
    if (opt.allow_logo) {
      box.append(h('h3', { class: 'section' }, t('brand.logo')), logoImg(state.club) || h('p', { class: 'muted' }, t('brand.noLogo')),
        h('div', { class: 'row gap wrap' },
          button(t('brand.upload'), () => guard(async () => { const f = await pickImage(); if (f) await setLogo(() => uploadClubLogo(state.club.id, f)); }), 'btn small'),
          state.club.logo_path ? button(t('brand.removeLogo'), () => guard(() => setLogo(() => removeClubLogo(state.club.id))), 'btn small ghost') : null));
    }
  }
  draw();
  return box;
}
