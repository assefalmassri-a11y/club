// Discount coupons (owner / branch manager).
import { sb } from '../supa.js';
import { state } from '../state.js';
import { h, clear, badge, button, openForm, guard, fmtDate } from '../dom.js';
import { t } from '../i18n.js';

async function edit(c) {
  const ok = await openForm({
    title: c ? c.code : t('cp.add'),
    fields: [
      { name: 'code', label: t('cp.code'), required: true, maxlength: 24, dir: 'ltr', value: c ? c.code : '' },
      { name: 'pct', label: t('cp.pct'), required: true, inputmode: 'numeric', dir: 'ltr', value: c ? String(c.pct) : '10' },
      { name: 'from', label: t('cp.from'), type: 'date', value: c && c.valid_from ? c.valid_from : '' },
      { name: 'to', label: t('cp.to'), type: 'date', value: c && c.valid_to ? c.valid_to : '' },
      { name: 'max', label: t('cp.max'), inputmode: 'numeric', dir: 'ltr', value: c && c.max_uses ? String(c.max_uses) : '' },
      { name: 'active', label: t('shop.active'), type: 'select', options: [{ value: '1', label: t('shop.yes') }, { value: '0', label: t('shop.no') }], value: c && !c.active ? '0' : '1' },
    ],
    onSubmit: async (v) => {
      const pct = Number(v.pct); const max = v.max ? Number(v.max) : null;
      if (!Number.isInteger(pct) || pct < 1 || pct > 100 || (max !== null && (!Number.isInteger(max) || max < 1))) throw new Error(t('err.invalid'));
      const { error } = await sb.rpc('upsert_coupon', { p_club: state.club.id, p_code: v.code, p_pct: pct, p_from: v.from || null, p_to: v.to || null, p_max: max, p_active: v.active === '1' });
      if (error) throw error;
    },
  });
  return ok === true;
}

export async function openCoupons() {
  const overlay = h('div', { class: 'overlay' }); const body = h('div', { class: 'list-simple' });
  async function load() {
    clear(body);
    const { data, error } = await sb.from('coupons').select('id, code, pct, valid_from, valid_to, max_uses, used, active').eq('club_id', state.club.id).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    if (!(data || []).length) { body.append(h('p', { class: 'muted' }, t('common.empty'))); return; }
    for (const c of data) body.append(h('div', { class: 'item' },
      h('span', null, h('strong', { class: 'ltr' }, c.code), ` −${c.pct}% `, c.active ? badge(t('shop.yes'), 'ok') : badge(t('shop.no'), 'bad'),
        h('div', { class: 'muted small' }, `${t('cp.used')}: ${c.used}${c.max_uses ? `/${c.max_uses}` : ''}${c.valid_to ? ` · ${fmtDate(c.valid_to)}` : ''}`)),
      button(t('shop.edit'), async () => { if (await guard(() => edit(c))) guard(load); }, 'btn small')));
  }
  overlay.append(h('div', { class: 'modal' }, h('h2', null, t('cp.title')), body,
    h('div', { class: 'row end' }, button(t('cp.add'), async () => { if (await guard(() => edit(null))) guard(load); }, 'btn primary'), button(t('common.close'), () => overlay.remove()))));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  await load();
}
