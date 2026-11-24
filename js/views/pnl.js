// Monthly profit & loss from the ledger (per currency, by label) + CSV for the accountant.
import { sb } from '../supa.js';
import { state, scoped } from '../state.js';
import { h, clear, button, guard, fmtMoney, decimals } from '../dom.js';
import { t } from '../i18n.js';
import { downloadCsv } from '../csv.js';

export async function openPnl() {
  const now = new Date();
  const month = h('input', { type: 'month', value: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, 'aria-label': t('pay.month') });
  const out = h('div'); let entries = [];
  async function load() {
    clear(out);
    const [y, m] = month.value.split('-').map(Number); if (!y || !m) return;
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const to = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    const { data, error } = await scoped(sb.from('ledger_entries').select('entry_date, kind, label, currency, amount_minor, branch_id, invoice_id').is('voided_at', null).gte('entry_date', from).lte('entry_date', to).order('entry_date').limit(5000));
    if (error) throw error;
    entries = data || [];
    if (!entries.length) { out.append(h('p', { class: 'muted' }, t('common.empty'))); return; }
    const by = new Map();
    for (const r of entries) {
      const c = String(r.currency).trim(); if (!by.has(c)) by.set(c, { inc: 0, exp: 0, labels: new Map() });
      const x = by.get(c); const a = Number(r.amount_minor);
      if (r.kind === 'income') x.inc += a; else x.exp += a;
      const k = `${r.kind}|${r.label}`; x.labels.set(k, (x.labels.get(k) || 0) + a);
    }
    for (const [c, x] of by) {
      const top = [...x.labels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
      out.append(h('div', { class: 'card-box' }, h('h3', null, c),
        h('div', { class: 'kv' }, h('span', null, t('ov.income')), h('bdi', null, fmtMoney(x.inc, c))),
        h('div', { class: 'kv' }, h('span', null, t('ov.expense')), h('bdi', null, fmtMoney(x.exp, c))),
        h('div', { class: 'kv' }, h('strong', null, t('pnl.net')), h('strong', null, h('bdi', null, fmtMoney(x.inc - x.exp, c)))),
        x.inc ? h('div', { class: 'muted small' }, `${t('pnl.margin')}: ${Math.round(((x.inc - x.exp) / x.inc) * 100)}%`) : null,
        h('div', { class: 'list-simple' }, top.map(([k, v]) => { const [kind, ...l] = k.split('|'); return h('div', { class: 'item' }, h('span', null, `${kind === 'income' ? '+' : '−'} ${l.join('|')}`), h('bdi', { class: 'muted small' }, fmtMoney(v, c))); }))));
    }
  }
  month.addEventListener('change', () => guard(load));
  const overlay = h('div', { class: 'overlay print-overlay' });
  overlay.append(h('div', { class: 'modal' }, h('h2', null, `${t('pnl.title')} — ${state.club.name}`), h('label', { class: 'field' }, h('span', null, t('pay.month')), month), out,
    h('div', { class: 'row end' },
      button(t('rep.export'), () => downloadCsv(`pnl-${month.value}.csv`, ['date', 'type', 'description', 'currency', 'amount'],
        entries.map((r) => [r.entry_date, r.kind, r.label, String(r.currency).trim(), Number(r.amount_minor) / 10 ** decimals(String(r.currency).trim())]))),
      button(t('mem.print'), () => window.print()), button(t('common.close'), () => overlay.remove(), 'btn primary'))));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  await load();
}
