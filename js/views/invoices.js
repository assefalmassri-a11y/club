import { sb } from '../supa.js';
import { logoImg } from '../brand.js';
import { state, scoped, canManage, currency } from '../state.js';
import { h, clear, badge, button, openForm, toast, guard, fmtDate, fmtMoney, toMinor, today, endOfMonth } from '../dom.js';
import { t } from '../i18n.js';

// Shared with the members view. Pass memberId to pre-select a member; otherwise a member must be picked.
export async function openNewInvoice({ memberId, memberName } = {}) {
  let members = [];
  if (!memberId) {
    const { data, error } = await scoped(sb.from('members').select('id, full_name').order('full_name').limit(200));
    if (error) throw error;
    members = data || [];
    if (!members.length) { toast(t('common.empty'), 'error'); return false; }
  }
  const cur = currency();
  const ok = await openForm({
    title: memberName ? `${t('inv.new')}: ${memberName}` : t('inv.new'),
    fields: [
      memberId ? null : { name: 'member', label: t('inv.member'), type: 'select', required: true, options: members.map((m) => ({ value: m.id, label: m.full_name })) },
      { name: 'label', label: t('inv.label'), required: true, maxlength: 140 },
      { name: 'amount', label: `${t('inv.amount')} (${cur})`, type: 'number', required: true, min: '0', step: 'any' },
      { name: 'issue', label: t('inv.issueDate'), type: 'date', required: true, value: today() },
      { name: 'due', label: t('inv.dueDate'), type: 'date', required: true, value: endOfMonth(today()) },
    ].filter(Boolean),
    onSubmit: async (v) => {
      const minor = toMinor(v.amount, cur);
      if (minor === null) throw new Error(t('err.amount'));
      const { error } = await sb.rpc('create_invoice', {
        p_member_id: memberId || v.member, p_label: v.label, p_issue_date: v.issue, p_due_date: v.due,
        p_currency: cur, p_amount_minor: minor, p_membership_id: null,
      });
      if (error) throw error;
    },
  });
  if (ok === true) toast(t('inv.created'), 'ok');
  return ok === true;
}

function statusOf(inv) {
  if (inv.status === 'issued' && inv.due_date < today()) return 'overdue';
  return inv.status;
}
const KIND = { issued: 'warn', paid: 'ok', void: '', overdue: 'bad' };

// Printable invoice for any status (receipt details are added once it is paid).
export function showInvoice(inv, memberName) {
  const overlay = h('div', { class: 'overlay print-overlay' });
  const cur = String(inv.currency).trim();
  const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('strong', null, v));
  const paid = inv.status === 'paid';
  const card = h('div', { class: 'id-card receipt invoice-doc' },
    logoImg(state.club),
    h('div', { class: 'id-club' }, state.club.name),
    h('div', { class: 'muted' }, paid ? t('inv.receipt') : t('inv.invoice')),
    h('div', { class: 'id-name' }, memberName || ''),
    kv(t('inv.number'), h('span', { class: 'ltr' }, `#${inv.number}`)),
    kv(t('inv.label'), inv.label || t('common.none')),
    inv.issue_date ? kv(t('inv.issueDate'), fmtDate(inv.issue_date)) : null,
    inv.due_date ? kv(t('inv.dueDate'), fmtDate(inv.due_date)) : null,
    kv(t('common.status'), t(`inv.status.${inv.status}`)),
    paid ? kv(t('inv.paidOn'), fmtDate(inv.paid_on)) : null,
    paid ? kv(t('inv.method'), inv.payment_method ? t(`inv.m.${inv.payment_method}`) : t('common.none')) : null,
    h('div', { class: 'id-no' }, h('bdi', null, fmtMoney(inv.amount_minor, cur))));
  overlay.append(h('div', { class: 'modal small' }, card,
    h('div', { class: 'row end' }, button(t('common.close'), () => overlay.remove()), button(t('mem.print'), () => window.print(), 'btn primary'))));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}

export async function render(box) {
  const filter = h('select', { 'aria-label': t('common.status') },
    [['', t('common.all')], ['issued', t('inv.status.issued')], ['paid', t('inv.status.paid')], ['void', t('inv.status.void')]]
      .map(([v, l]) => h('option', { value: v }, l)));
  const list = h('div', { class: 'table-wrap' });
  box.append(h('div', { class: 'row between wrap' }, h('h2', null, t('inv.title')),
    h('div', { class: 'row gap' }, filter, button(t('inv.new'), async () => { if (await guard(() => openNewInvoice())) load(); }, 'btn primary'))), list);

  async function load() {
    clear(list);
    let q = scoped(sb.from('invoices').select('id, number, member_id, label, amount_minor, currency, due_date, issue_date, status, paid_on, payment_method').order('number', { ascending: false }).limit(100));
    if (filter.value) q = q.eq('status', filter.value);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) { list.append(h('p', { class: 'muted' }, t('common.empty'))); return; }
    const ids = [...new Set(rows.map((r) => r.member_id))];
    const { data: ms } = await sb.from('members').select('id, full_name').in('id', ids);
    const names = new Map((ms || []).map((m) => [m.id, m.full_name]));

    const body = rows.map((inv) => {
      const st = statusOf(inv);
      const actions = [];
      if (inv.status === 'issued') {
        actions.push(button(t('inv.markPaid'), async () => {
          const ok = await openForm({
            title: `${t('inv.markPaid')} #${inv.number}`,
            fields: [{ name: 'method', label: t('inv.method'), type: 'select', required: true, value: 'cash', options: ['cash', 'transfer', 'card', 'other'].map((m) => ({ value: m, label: t(`inv.m.${m}`) })) }],
            onSubmit: async (v) => {
              const { error: e } = await sb.rpc('mark_invoice_paid', { p_invoice_id: inv.id, p_paid_on: today(), p_method: v.method });
              if (e) throw e;
            },
          });
          if (ok === true) { toast(t('inv.paid'), 'ok'); await load(); }
        }, 'btn small primary'));
      }
      actions.push(button(t('mem.print'), () => showInvoice(inv, names.get(inv.member_id)), 'btn small'));
      if (canManage() && inv.status !== 'void') {
        actions.push(button(t('inv.void'), async () => {
          const ok = await openForm({
            title: `${t('inv.void')} #${inv.number}`,
            fields: [{ name: 'reason', label: t('inv.voidReason'), type: 'textarea', required: true, maxlength: 300 }],
            onSubmit: async (v) => {
              const { error: e } = await sb.rpc('void_invoice', { p_invoice_id: inv.id, p_reason: v.reason });
              if (e) throw e;
            },
          });
          if (ok === true) { toast(t('inv.voided'), 'ok'); load(); }
        }, 'btn small'));
      }
      return h('tr', null,
        h('td', { 'data-label': t('inv.number'), dir: 'ltr' }, `#${inv.number}`),
        h('td', { 'data-label': t('inv.member') }, names.get(inv.member_id) || t('common.none')),
        h('td', { 'data-label': t('inv.label') }, inv.label),
        h('td', { 'data-label': t('inv.amount') }, h('bdi', null, fmtMoney(inv.amount_minor, inv.currency.trim()))),
        h('td', { 'data-label': t('inv.dueDate') }, fmtDate(inv.due_date)),
        h('td', { 'data-label': t('common.status') }, badge(t(`inv.status.${st}`), KIND[st])),
        h('td', { class: 'actions', 'data-label': t('common.actions') }, actions));
    });
    list.append(h('table', { class: 'grid' },
      h('thead', null, h('tr', null, [t('inv.number'), t('inv.member'), t('inv.label'), t('inv.amount'), t('inv.dueDate'), t('common.status'), t('common.actions')].map((c) => h('th', null, c)))),
      h('tbody', null, body)));
  }

  filter.addEventListener('change', () => guard(load));
  await load();
  return null;
}

// Split a total into N monthly invoices (atomic in the database; the last one absorbs the remainder).
export async function openInstallments({ memberId, memberName }) {
  const cur = currency();
  const ok = await openForm({
    title: `${t('inst.title')}: ${memberName}`,
    fields: [
      { name: 'label', label: t('inv.label'), required: true, maxlength: 120 },
      { name: 'total', label: `${t('inst.total')} (${cur})`, required: true, inputmode: 'decimal', dir: 'ltr' },
      { name: 'count', label: t('inst.count'), required: true, inputmode: 'numeric', dir: 'ltr', value: '3' },
      { name: 'first', label: t('inst.first'), type: 'date', required: true, value: endOfMonth(today()) },
    ],
    onSubmit: async (v) => {
      const total = toMinor(v.total, cur); const n = Number(v.count);
      if (total === null || !Number.isInteger(n) || n < 2 || n > 24) throw new Error(t('err.invalid'));
      const { error } = await sb.rpc('create_installments', { p_member: memberId, p_label: v.label, p_total: total, p_currency: cur, p_count: n, p_first_due: v.first });
      if (error) throw error;
    },
  });
  if (ok === true) toast(t('inst.done'), 'ok');
  return ok === true;
}
