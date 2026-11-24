import { sb } from '../supa.js';
import { state, scoped, canManage } from '../state.js';
import { h, clear, badge, button, openForm, toast, guard, fmtDate, fmtMoney, toMinor, today, addDays, decimals } from '../dom.js';
import { t } from '../i18n.js';
import { openNewInvoice } from './invoices.js';

const STATUS_KIND = { active: 'ok', frozen: 'warn', expired: 'bad', cancelled: 'bad' };

function branchName(id) { const b = state.branches.find((x) => x.id === id); return b ? b.name : t('common.none'); }
function branchOptions() { return state.branches.map((b) => ({ value: b.id, label: b.name })); }

async function addMember() {
  const ok = await openForm({
    title: t('mem.add'),
    fields: [
      { name: 'name', label: t('mem.name'), required: true, maxlength: 120 },
      { name: 'phone', label: t('mem.phone'), type: 'tel', maxlength: 30, dir: 'ltr' },
      { name: 'email', label: t('mem.email'), type: 'email', maxlength: 120, dir: 'ltr' },
      { name: 'branch', label: t('common.branch'), type: 'select', options: branchOptions(), value: state.branchId || (state.branches[0] && state.branches[0].id), required: true },
    ],
    onSubmit: async (v) => {
      const { error } = await sb.from('members').insert({
        club_id: state.club.id, branch_id: v.branch, full_name: v.name, phone: v.phone || null, email: v.email || null,
      });
      if (error) throw error;
    },
  });
  return ok === true;
}

async function managePlans() {
  const { data: plans, error } = await sb.from('membership_plans').select('id, name, price_cents, currency, duration_days, active, branch_id').order('name');
  if (error) throw error;
  const lines = (plans || []).map((p) => `${p.name} — ${fmtMoney(p.price_cents, p.currency.trim())} / ${p.duration_days}${p.active ? '' : ' (x)'}`);
  const overlay = h('div', { class: 'overlay' });
  const close = () => overlay.remove();
  const addBtn = button(t('mem.addPlan'), async () => {
    const cur = state.club.default_currency.trim();
    await openForm({
      title: t('mem.addPlan'),
      fields: [
        { name: 'name', label: t('mem.planName'), required: true, maxlength: 80 },
        { name: 'price', label: `${t('mem.planPrice')} (${cur})`, type: 'number', required: true, min: '0', step: String(1 / 10 ** decimals(cur)) },
        { name: 'days', label: t('mem.planDays'), type: 'number', required: true, min: '1', step: '1' },
      ],
      onSubmit: async (v) => {
        const minor = Number.isFinite(Number(v.price)) && Number(v.price) >= 0 ? Math.round(Number(v.price) * 10 ** decimals(cur)) : null;
        const days = Number(v.days);
        if (minor === null || !Number.isInteger(days) || days < 1) throw new Error(t('err.invalid'));
        const { error: e } = await sb.from('membership_plans').insert({ club_id: state.club.id, name: v.name, price_cents: minor, currency: cur, duration_days: days });
        if (e) throw e;
      },
    });
    close();
    managePlans().catch((e) => toast(String(e.message || e), 'error'));
  }, 'btn primary');
  overlay.append(h('div', { class: 'modal' }, h('h2', null, t('mem.plans')),
    lines.length ? h('ul', { class: 'plain' }, lines.map((l) => h('li', null, l))) : h('p', { class: 'muted' }, t('mem.noPlans')),
    h('div', { class: 'row end' }, button(t('common.close'), close), addBtn)));
  document.body.append(overlay);
}

async function subscribe(member) {
  const { data: plans, error } = await sb.from('membership_plans').select('id, name, price_cents, currency, duration_days, branch_id').eq('active', true).order('name');
  if (error) throw error;
  const usable = (plans || []).filter((p) => !p.branch_id || p.branch_id === member.branch_id);
  if (!usable.length) { toast(t('mem.noPlans'), 'error'); return false; }
  const ok = await openForm({
    title: `${t('mem.subscribe')}: ${member.full_name}`,
    fields: [
      { name: 'plan', label: t('mem.plan'), type: 'select', required: true, options: usable.map((p) => ({ value: p.id, label: `${p.name} — ${fmtMoney(p.price_cents, p.currency.trim())}` })) },
      { name: 'start', label: t('mem.startsOn'), type: 'date', required: true, value: today() },
    ],
    onSubmit: async (v) => {
      const plan = usable.find((p) => p.id === v.plan);
      if (!plan) throw new Error(t('err.invalid'));
      const { error: e } = await sb.from('memberships').insert({
        club_id: state.club.id, member_id: member.id, plan_id: plan.id, branch_id: member.branch_id,
        starts_on: v.start, ends_on: addDays(v.start, plan.duration_days - 1),
        price_cents: plan.price_cents, currency: plan.currency.trim(),
      });
      if (e) throw e;
    },
  });
  if (ok === true) toast(t('mem.subscribed'), 'ok');
  return ok === true;
}

async function issueCard(member) {
  const ok = await openForm({
    title: `${t('mem.card')}: ${member.full_name}`,
    fields: [
      { name: 'uid', label: t('mem.cardUid'), required: true, maxlength: 40, dir: 'ltr', placeholder: '04 A1 B2 C3' },
      { name: 'label', label: t('mem.cardLabel'), maxlength: 60 },
    ],
    onSubmit: async (v) => {
      const { error } = await sb.rpc('issue_card', { p_member_id: member.id, p_card_uid: v.uid, p_label: v.label || null });
      if (error) throw error;
    },
  });
  if (ok === true) toast(t('mem.cardIssued'), 'ok');
}

async function showInvite(member) {
  const { data: code, error } = await sb.rpc('create_member_invite', { p_member_id: member.id });
  if (error) throw error;
  const overlay = h('div', { class: 'overlay' });
  overlay.append(h('div', { class: 'modal small' }, h('h2', null, t('mem.inviteTitle')), h('p', { class: 'muted' }, member.full_name),
    h('div', { class: 'secret tile-value', dir: 'ltr' }, String(code).replace(/(.{4})(?=.)/g, '$1-')),
    h('p', { class: 'muted small' }, t('mem.inviteHelp')),
    h('div', { class: 'row end' }, button(t('common.close'), () => overlay.remove(), 'btn primary'))));
  document.body.append(overlay);
}

export async function render(box, ctx) {
  const search = h('input', { type: 'search', placeholder: t('common.search'), maxlength: 60, 'aria-label': t('common.search') });
  const list = h('div', { class: 'table-wrap' });
  const header = h('div', { class: 'row between wrap' },
    h('h2', null, t('mem.title')),
    h('div', { class: 'row gap' }, search,
      canManage() ? button(t('mem.plans'), () => guard(managePlans)) : null,
      button(t('mem.add'), async () => { if (await addMember()) load(); }, 'btn primary')));
  box.append(header, list);

  async function load() {
    clear(list);
    let q = scoped(sb.from('members').select('id, full_name, phone, email, status, branch_id').order('full_name').limit(100));
    const term = search.value.trim().replace(/[%_\\,()]/g, ' ');
    if (term) q = q.ilike('full_name', `%${term}%`);
    const { data, error } = await q;
    if (error) throw error;
    const members = data || [];
    if (!members.length) { list.append(h('p', { class: 'muted' }, t('common.empty'))); return; }

    const ids = members.map((m) => m.id);
    const { data: ms } = await sb.from('memberships').select('member_id, ends_on, status').in('member_id', ids).in('status', ['active', 'paused']).gte('ends_on', today()).order('ends_on', { ascending: false });
    const until = new Map();
    for (const r of ms || []) if (!until.has(r.member_id)) until.set(r.member_id, r.ends_on);

    const body = members.map((m) => h('tr', null,
      h('td', { 'data-label': t('mem.name') }, h('strong', null, m.full_name), h('div', { class: 'muted small', dir: 'ltr' }, m.phone || '')),
      h('td', { 'data-label': t('common.branch') }, branchName(m.branch_id)),
      h('td', { 'data-label': t('common.status') }, badge(t(`mem.status.${m.status}`), STATUS_KIND[m.status])),
      h('td', { 'data-label': t('mem.membership') }, until.has(m.id) ? `${t('mem.until')} ${fmtDate(until.get(m.id))}` : h('span', { class: 'muted' }, t('mem.noMembership'))),
      h('td', { class: 'actions', 'data-label': t('common.actions') },
        button(t('mem.checkin'), () => guard(async () => {
          const { error: e } = await sb.rpc('check_in_member', { p_member_id: m.id, p_branch_id: m.branch_id });
          if (e) throw e;
          toast(t('mem.checkedIn'), 'ok');
        }), 'btn small'),
        button(t('mem.subscribe'), async () => { if (await guard(() => subscribe(m))) load(); }, 'btn small'),
        button(t('mem.invoice'), () => guard(() => openNewInvoice({ memberId: m.id, memberName: m.full_name })), 'btn small'),
        button(t('mem.card'), () => guard(() => issueCard(m)), 'btn small'),
        button(t('mem.invite'), () => guard(() => showInvite(m)), 'btn small'),
        button(t('mem.chat'), () => guard(async () => {
          const { data: id, error: e } = await sb.rpc('open_support_conversation', { p_member: m.id });
          if (e) throw e;
          state.openConversation = id;
          ctx.goto('chat');
        }), 'btn small'))));

    list.append(h('table', { class: 'grid' },
      h('thead', null, h('tr', null, [t('mem.name'), t('common.branch'), t('common.status'), t('mem.membership'), t('common.actions')].map((c) => h('th', null, c)))),
      h('tbody', null, body)));
  }

  let timer = null;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => guard(load), 300); });
  await load();
  return () => clearTimeout(timer);
}
