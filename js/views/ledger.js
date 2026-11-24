import { sb } from '../supa.js';
import { state, scoped, currency } from '../state.js';
import { h, clear, badge, button, openForm, toast, guard, fmtDate, fmtMoney, toMinor, today } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';

function branchName(id) { const b = state.branches.find((x) => x.id === id); return b ? b.name : t('common.none'); }

export async function render(box) {
  const totals = h('div', { class: 'tiles' });
  const list = h('div', { class: 'table-wrap' });
  box.append(h('div', { class: 'row between wrap' }, h('h2', null, t('led.title')),
    button(t('led.add'), async () => { if (await guard(addEntry)) load(); }, 'btn primary')), totals, list);

  async function addEntry() {
    const cur = currency();
    const ok = await openForm({
      title: t('led.add'),
      fields: [
        { name: 'kind', label: t('led.kind'), type: 'select', required: true, options: [{ value: 'income', label: t('led.income') }, { value: 'expense', label: t('led.expense') }] },
        { name: 'branch', label: t('common.branch'), type: 'select', required: true, options: state.branches.map((b) => ({ value: b.id, label: b.name })), value: state.branchId || (state.branches[0] && state.branches[0].id) },
        { name: 'date', label: t('common.date'), type: 'date', required: true, value: today() },
        { name: 'label', label: t('led.label'), required: true, maxlength: 140 },
        { name: 'amount', label: `${t('led.amount')} (${cur})`, type: 'number', required: true, min: '0', step: 'any' },
      ],
      onSubmit: async (v) => {
        const minor = toMinor(v.amount, cur);
        if (minor === null) throw new Error(t('err.amount'));
        const { error } = await sb.rpc('add_ledger_entry', { p_branch_id: v.branch, p_kind: v.kind, p_date: v.date, p_label: v.label, p_currency: cur, p_amount_minor: minor });
        if (error) throw error;
      },
    });
    if (ok === true) toast(t('led.added'), 'ok');
    return ok === true;
  }

  async function load() {
    clear(totals); clear(list);
    const { data: tot } = await scoped(sb.from('ledger_totals').select('*'));
    const byCur = new Map();
    for (const r of tot || []) {
      const c = (r.currency || '').trim();
      const a = byCur.get(c) || { i: 0, e: 0 };
      a.i += Number(r.income_minor || 0); a.e += Number(r.expense_minor || 0); byCur.set(c, a);
    }
    for (const [c, v] of byCur) {
      totals.append(
        h('div', { class: 'tile ok' }, h('span', { class: 'tile-ic' }, icon('wallet', 20)), h('div', { class: 'tile-value small' }, h('bdi', null, fmtMoney(v.i, c))), h('div', { class: 'tile-label' }, t('led.income'))),
        h('div', { class: 'tile bad' }, h('span', { class: 'tile-ic' }, icon('wallet', 20)), h('div', { class: 'tile-value small' }, h('bdi', null, fmtMoney(v.e, c))), h('div', { class: 'tile-label' }, t('led.expense'))),
        h('div', { class: 'tile' }, h('span', { class: 'tile-ic' }, icon('ledger', 20)), h('div', { class: 'tile-value small' }, h('bdi', null, fmtMoney(v.i - v.e, c))), h('div', { class: 'tile-label' }, t('ov.balance'))));
    }
    const { data, error } = await scoped(sb.from('ledger_entries').select('id, branch_id, kind, entry_date, label, currency, amount_minor, voided_at').is('voided_at', null).order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(100));
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) { list.append(h('p', { class: 'muted' }, t('common.empty'))); return; }
    const body = rows.map((r) => h('tr', null,
      h('td', { 'data-label': t('common.date') }, fmtDate(r.entry_date)),
      h('td', { 'data-label': t('led.kind') }, badge(t(`led.${r.kind}`), r.kind === 'income' ? 'ok' : 'bad')),
      h('td', { 'data-label': t('led.label') }, r.label),
      h('td', { 'data-label': t('common.branch') }, branchName(r.branch_id)),
      h('td', { 'data-label': t('led.amount') }, h('bdi', null, fmtMoney(r.amount_minor, r.currency.trim())))));
    list.append(h('table', { class: 'grid' },
      h('thead', null, h('tr', null, [t('common.date'), t('led.kind'), t('led.label'), t('common.branch'), t('led.amount')].map((c) => h('th', null, c)))),
      h('tbody', null, body)));
  }
  await load();
  return null;
}
