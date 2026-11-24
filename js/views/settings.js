import { sb } from '../supa.js';
import { state } from '../state.js';
import { h, button, openForm, toast, guard, errText } from '../dom.js';
import { t } from '../i18n.js';
import { pushControl } from '../push.js';
import { langControl } from '../lang.js';
import { loadRates, clearRates } from '../fx.js';

export async function render(box) {
  const branchesEl = h('div', { class: 'list-simple' });
  const isOwner = state.role === 'owner';
  const fxEl = h('div', { class: 'list-simple' });

  box.append(h('h2', null, t('set.title')),
    h('h3', { class: 'section' }, t('set.club')),
    h('div', { class: 'list-simple' },
      h('div', { class: 'item' }, h('span', { class: 'muted' }, t('ctx.clubName')), h('strong', null, state.club.name)),
      h('div', { class: 'item' }, h('span', { class: 'muted' }, t('set.currency')), h('strong', null, state.club.default_currency.trim())),
      h('div', { class: 'item' }, h('span', { class: 'muted' }, t('set.timezone')), h('strong', { class: 'ltr' }, state.club.timezone || ''))),
    isOwner ? h('div', { class: 'row between wrap section' }, h('h3', null, t('fx.title')), button(t('fx.set'), async () => { if (await guard(setFx)) { clearRates(); await drawFx(); } }, 'btn small primary')) : null,
    isOwner ? fxEl : null,
    h('div', { class: 'row between wrap section' }, h('h3', null, t('set.branches')),
      isOwner ? button(t('set.addBranch'), async () => { if (await guard(addBranch)) { await refreshBranches(); } }, 'btn small primary') : null),
    branchesEl,
    h('h3', { class: 'section' }, t('set.account')),
    h('div', { class: 'list-simple' }, h('div', { class: 'item' }, h('span', { class: 'muted' }, t('auth.email')), h('strong', { class: 'ltr' }, state.session.user.email || '')),
      pushControl(), langControl()),
    h('div', { class: 'row end', style: null }, button(t('set.changePassword'), () => guard(changePassword), 'btn')));

  async function drawFx() {
    while (fxEl.firstChild) fxEl.removeChild(fxEl.firstChild);
    const rates = await loadRates(true);
    if (!rates.size) fxEl.append(h('p', { class: 'muted' }, t('fx.none')));
    for (const [k, v] of rates) { const [a, b] = k.split('>'); fxEl.append(h('div', { class: 'item' }, h('strong', { class: 'ltr' }, `1 ${a} = ${v.rate} ${b}`), h('span', { class: 'muted small' }, v.on))); }
  }
  async function setFx() {
    const cur = state.club.default_currency.trim();
    const ok = await openForm({
      title: t('fx.title'),
      fields: [
        { name: 'from', label: t('fx.from'), required: true, maxlength: 3, dir: 'ltr', value: 'USD' },
        { name: 'to', label: t('fx.to'), required: true, maxlength: 3, dir: 'ltr', value: cur === 'USD' ? 'SYP' : cur },
        { name: 'rate', label: t('fx.rate'), required: true, inputmode: 'decimal', dir: 'ltr' },
      ],
      onSubmit: async (v) => {
        const r = Number(String(v.rate).replace(',', '.'));
        if (!(r > 0) || !/^[A-Za-z]{3}$/.test(v.from) || !/^[A-Za-z]{3}$/.test(v.to) || v.from.toUpperCase() === v.to.toUpperCase()) throw new Error(t('err.invalid'));
        const { error } = await sb.rpc('set_fx_rate', { p_club: state.club.id, p_from: v.from, p_to: v.to, p_rate: r });
        if (error) throw error;
      },
    });
    if (ok === true) toast(t('fx.saved'), 'ok');
    return ok === true;
  }

  async function addBranch() {
    const ok = await openForm({
      title: t('set.addBranch'),
      fields: [
        { name: 'name', label: t('set.branchName'), required: true, maxlength: 80 },
        { name: 'address', label: t('set.address'), maxlength: 200 },
      ],
      onSubmit: async (v) => {
        const { error } = await sb.from('branches').insert({ club_id: state.club.id, name: v.name, address: v.address || null });
        if (error) throw error;
      },
    });
    if (ok === true) toast(t('set.branchAdded'), 'ok');
    return ok === true;
  }

  async function changePassword() {
    await openForm({
      title: t('set.changePassword'),
      fields: [{ name: 'pw', label: t('set.newPassword'), type: 'password', required: true, maxlength: 128, dir: 'ltr' }],
      onSubmit: async (v) => {
        if (v.pw.length < 10) throw new Error(t('auth.passwordHint'));
        const { error } = await sb.auth.updateUser({ password: v.pw });
        if (error) throw error;
        toast(t('set.passwordChanged'), 'ok');
      },
    });
  }

  async function refreshBranches() {
    const { data, error } = await sb.from('branches').select('id, name, address').eq('club_id', state.club.id).order('created_at');
    if (error) throw error;
    state.branches = (data || []).filter((b) => state.branches.some((x) => x.id === b.id) || isOwner);
    while (branchesEl.firstChild) branchesEl.removeChild(branchesEl.firstChild);
    for (const b of data || []) branchesEl.append(h('div', { class: 'item' }, h('strong', null, b.name), h('span', { class: 'muted' }, b.address || '')));
  }
  await refreshBranches();
  if (isOwner) await drawFx();
  return null;
}
