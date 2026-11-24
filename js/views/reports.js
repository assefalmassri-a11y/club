import { sb } from '../supa.js';
import { state, scoped, currency } from '../state.js';
import { h, button, guard, fmtMoney, today, addDays, toast } from '../dom.js';
import { t } from '../i18n.js';
import { downloadCsv } from '../csv.js';
import { openForm } from '../dom.js';
import { openPnl } from './pnl.js';
import { openRatings, openMonthly } from './insights.js';

async function dayReport() {
  let day = today();
  const ok = await openForm({ title: t('rep.day'), fields: [{ name: 'd', label: t('common.date'), type: 'date', required: true, value: day }], onSubmit: async (v) => { day = v.d; } });
  if (ok !== true) return;
  const from = new Date(`${day}T00:00:00`); const to = new Date(from.getTime()); to.setDate(to.getDate() + 1);
  const [{ data: paid }, { data: led }, { count: visits }, { count: joined }] = await Promise.all([
    scoped(sb.from('invoices').select('amount_minor, currency, payment_method').eq('status', 'paid').eq('paid_on', day).limit(2000)),
    scoped(sb.from('ledger_entries').select('kind, amount_minor, currency, invoice_id').eq('entry_date', day).is('voided_at', null).limit(2000)),
    scoped(sb.from('checkins').select('id', { count: 'exact', head: true }).gte('checked_in_at', from.toISOString()).lt('checked_in_at', to.toISOString())),
    scoped(sb.from('members').select('id', { count: 'exact', head: true }).gte('created_at', from.toISOString()).lt('created_at', to.toISOString())),
  ]);
  const cur = new Map();
  const slot = (c) => { const k = String(c).trim(); if (!cur.has(k)) cur.set(k, { cash: 0, transfer: 0, card: 0, other: 0, none: 0, income: 0, expense: 0 }); return cur.get(k); };
  for (const r of paid || []) slot(r.currency)[r.payment_method || 'none'] += Number(r.amount_minor);
  for (const r of led || []) { const x = slot(r.currency); if (r.kind === 'income') x.income += Number(r.amount_minor); else x.expense += Number(r.amount_minor); }
  const rows = [...cur.entries()].map(([c, x]) => h('div', { class: 'card-box' }, h('h3', null, c),
    ...['cash', 'transfer', 'card', 'other'].filter((m) => x[m]).map((m) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, t(`inv.m.${m}`)), h('bdi', null, fmtMoney(x[m], c)))),
    h('div', { class: 'kv' }, h('span', { class: 'muted' }, t('ov.income')), h('bdi', null, fmtMoney(x.income, c))),
    h('div', { class: 'kv' }, h('span', { class: 'muted' }, t('ov.expense')), h('bdi', null, fmtMoney(x.expense, c))),
    h('div', { class: 'kv' }, h('strong', null, t('ov.balance')), h('strong', null, h('bdi', null, fmtMoney(x.income - x.expense, c))))));
  const overlay = h('div', { class: 'overlay print-overlay' });
  overlay.append(h('div', { class: 'modal' }, h('h2', null, `${t('rep.day')} — ${day}`),
    h('div', { class: 'kv' }, h('span', { class: 'muted' }, t('rep.visitsToday')), h('strong', null, String(visits ?? 0))),
    h('div', { class: 'kv' }, h('span', { class: 'muted' }, t('rep.joinedToday')), h('strong', null, String(joined ?? 0))),
    rows.length ? rows : h('p', { class: 'muted' }, t('common.empty')),
    h('div', { class: 'row end' }, button(t('common.close'), () => overlay.remove()), button(t('mem.print'), () => window.print(), 'btn primary'))));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}

function fill(i, max) {
  const el = h('span', { class: `bar-fill ${i.tone || ''}` });
  el.style.width = `${Math.round((i.value / max) * 100)}%`; // CSSOM is allowed under CSP (inline style attributes are not)
  return el;
}

function bars(title, items, fmt) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return h('div', { class: 'card-box' }, h('h3', null, title),
    h('div', { class: 'bars' }, items.map((i) => h('div', { class: 'bar-row' },
      h('span', { class: 'bar-label' }, i.label),
      h('span', { class: 'bar-track' }, fill(i, max)),
      h('bdi', { class: 'bar-val' }, fmt ? fmt(i.value) : String(i.value))))));
}
const ym = (d) => String(d).slice(0, 7);

async function fetchAll(make) {
  const out = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function render(box) {
  const cur = currency();
  const months = [];
  const d0 = new Date(); d0.setDate(1);
  for (let i = 5; i >= 0; i--) { const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const since = `${months[0]}-01`;

  const [led, chk, mem] = await Promise.all([
    scoped(sb.from('ledger_entries').select('kind, entry_date, amount_minor, currency').is('voided_at', null).gte('entry_date', since).eq('currency', cur).limit(5000)),
    scoped(sb.from('checkins').select('checked_in_at').gte('checked_in_at', addDays(today(), -13)).limit(5000)),
    scoped(sb.from('members').select('joined_at').gte('joined_at', since).limit(5000)),
  ]);
  for (const r of [led, chk, mem]) if (r.error) throw r.error;

  const inc = new Map(months.map((m) => [m, 0])); const exp = new Map(months.map((m) => [m, 0]));
  for (const r of led.data || []) { const m = ym(r.entry_date); if (inc.has(m)) (r.kind === 'income' ? inc : exp).set(m, (r.kind === 'income' ? inc : exp).get(m) + Number(r.amount_minor)); }
  const days = []; for (let i = 13; i >= 0; i--) days.push(addDays(today(), -i));
  const perDay = new Map(days.map((d) => [d, 0]));
  for (const r of chk.data || []) { const dd = new Date(r.checked_in_at); const k = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`; if (perDay.has(k)) perDay.set(k, perDay.get(k) + 1); }
  const newM = new Map(months.map((m) => [m, 0]));
  for (const r of mem.data || []) { const m = ym(r.joined_at); if (newM.has(m)) newM.set(m, newM.get(m) + 1); }

  const exportBtn = (label, fn) => button(label, () => guard(async () => { await fn(); toast(t('rep.exported'), 'ok'); }), 'btn');
  box.append(
    h('h2', null, t('rep.title')),
    h('div', { class: 'grid-2' },
      bars(`${t('rep.income')} (${cur})`, months.map((m) => ({ label: m, value: inc.get(m), tone: 'ok' })), (v) => fmtMoney(v, cur)),
      bars(`${t('rep.expense')} (${cur})`, months.map((m) => ({ label: m, value: exp.get(m), tone: 'bad' })), (v) => fmtMoney(v, cur)),
      bars(t('rep.visits'), days.map((d) => ({ label: d.slice(5), value: perDay.get(d) }))),
      bars(t('rep.newMembers'), months.map((m) => ({ label: m, value: newM.get(m) })))),
    h('div', { class: 'row end gap' }, button(t('mr.title'), () => guard(openMonthly)), button(t('rt.title'), () => guard(openRatings)), button(t('pnl.title'), () => guard(openPnl)), button(t('rep.day'), () => guard(dayReport), 'btn primary')),
    h('h3', { class: 'section' }, t('rep.export')),
    h('div', { class: 'row gap' },
      exportBtn(t('rep.exMembers'), async () => {
        const rows = await fetchAll(() => scoped(sb.from('members').select('full_name, phone, email, status, joined_at').order('full_name')));
        downloadCsv('members.csv', ['name', 'phone', 'email', 'status', 'joined_at'], rows.map((r) => [r.full_name, r.phone, r.email, r.status, r.joined_at]));
      }),
      exportBtn(t('rep.exInvoices'), async () => {
        const rows = await fetchAll(() => scoped(sb.from('invoices').select('number, label, amount_minor, currency, issue_date, due_date, status, paid_on').order('number')));
        downloadCsv('invoices.csv', ['number', 'label', 'amount_minor', 'currency', 'issue_date', 'due_date', 'status', 'paid_on'], rows.map((r) => [r.number, r.label, r.amount_minor, r.currency, r.issue_date, r.due_date, r.status, r.paid_on]));
      }),
      exportBtn(t('rep.exCheckins'), async () => {
        const rows = await fetchAll(() => scoped(sb.from('checkins').select('member_id, checked_in_at, method').order('checked_in_at', { ascending: false })));
        downloadCsv('checkins.csv', ['member_id', 'checked_in_at', 'method'], rows.map((r) => [r.member_id, r.checked_in_at, r.method]));
      }),
      exportBtn(t('rep.exMemberships'), async () => {
        const rows = await fetchAll(() => scoped(sb.from('memberships').select('member_id, starts_on, ends_on, status, price_cents, currency').order('starts_on', { ascending: false })));
        downloadCsv('memberships.csv', ['member_id', 'starts_on', 'ends_on', 'status', 'price_cents', 'currency'], rows.map((r) => [r.member_id, r.starts_on, r.ends_on, r.status, r.price_cents, r.currency]));
      }),
      exportBtn(t('rep.exLedger'), async () => {
        const rows = await fetchAll(() => scoped(sb.from('ledger_entries').select('entry_date, kind, label, amount_minor, currency').is('voided_at', null).order('entry_date')));
        downloadCsv('ledger.csv', ['date', 'kind', 'label', 'amount_minor', 'currency'], rows.map((r) => [r.entry_date, r.kind, r.label, r.amount_minor, r.currency]));
      })),
    h('p', { class: 'muted small' }, t('rep.exNote')));
  return null;
}
