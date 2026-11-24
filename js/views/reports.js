import { sb } from '../supa.js';
import { state, scoped, currency } from '../state.js';
import { h, button, guard, fmtMoney, today, addDays, toast } from '../dom.js';
import { t } from '../i18n.js';
import { downloadCsv } from '../csv.js';

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
      exportBtn(t('rep.exLedger'), async () => {
        const rows = await fetchAll(() => scoped(sb.from('ledger_entries').select('entry_date, kind, label, amount_minor, currency').is('voided_at', null).order('entry_date')));
        downloadCsv('ledger.csv', ['date', 'kind', 'label', 'amount_minor', 'currency'], rows.map((r) => [r.entry_date, r.kind, r.label, r.amount_minor, r.currency]));
      })),
    h('p', { class: 'muted small' }, t('rep.exNote')));
  return null;
}
