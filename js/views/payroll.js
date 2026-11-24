// Owner-only: trainer pay rates and monthly payroll (events led x rate + attendees x rate).
import { sb } from '../supa.js';
import { state } from '../state.js';
import { h, clear, button, openForm, toast, guard, fmtMoney, toMinor, decimals, badge, confirmBox } from '../dom.js';
import { t } from '../i18n.js';
import { downloadCsv } from '../csv.js';

export async function setRate(row) {
  const cur0 = (row.currency || state.club.default_currency).trim();
  const d = decimals(cur0);
  const ok = await openForm({
    title: `${t('pay.rate')}: ${row.email || ''}`,
    fields: [
      { name: 'cur', label: t('set.currency'), required: true, maxlength: 3, dir: 'ltr', value: cur0 },
      { name: 'pe', label: t('pay.perEvent'), required: true, type: 'text', inputmode: 'decimal', dir: 'ltr', value: String(Number(row.per_event || 0) / 10 ** d) },
      { name: 'pa', label: t('pay.perAttendee'), required: true, type: 'text', inputmode: 'decimal', dir: 'ltr', value: String(Number(row.per_attendee || 0) / 10 ** d) },
    ],
    onSubmit: async (v) => {
      const cur = v.cur.toUpperCase();
      const conv = (x) => { if (Number(x) === 0) return 0; const m = toMinor(x, cur); if (m == null) throw new Error(t('err.invalid')); return m; };
      const { error } = await sb.rpc('set_trainer_rate', { p_club: state.club.id, p_staff: row.staff_id, p_currency: cur, p_per_event: conv(v.pe), p_per_attendee: conv(v.pa) });
      if (error) throw error;
    },
  });
  if (ok === true) toast(t('pay.saved'), 'ok');
  return ok === true;
}

export async function openPayroll() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const month = h('input', { type: 'month', value: iso(first).slice(0, 7), 'aria-label': t('pay.month') });
  const out = h('div');
  let rows = [];
  async function load() {
    clear(out);
    const [y, m] = month.value.split('-').map(Number);
    if (!y || !m) return;
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const to = iso(new Date(y, m, 0));
    const { data, error } = await sb.rpc('trainer_payroll', { p_club: state.club.id, p_from: from, p_to: to });
    if (error) throw error;
    rows = data || [];
    const { data: paidRows } = await sb.from('payroll_payments').select('staff_id').eq('club_id', state.club.id).eq('period', from);
    const paid = new Set((paidRows || []).map((p) => p.staff_id));
    if (!rows.length) { out.append(h('p', { class: 'muted' }, t('common.empty'))); return; }
    const totals = new Map();
    for (const r of rows) { const c = String(r.currency).trim(); totals.set(c, (totals.get(c) || 0) + Number(r.amount)); }
    out.append(h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', null, h('tr', null, [t('staff.email'), t('pay.events'), t('pay.attendees'), t('pay.amount'), t('common.actions')].map((c) => h('th', null, c)))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', { 'data-label': t('staff.email') }, h('span', { class: 'ltr' }, r.email || '')),
        h('td', { 'data-label': t('pay.events') }, String(r.events)),
        h('td', { 'data-label': t('pay.attendees') }, String(r.attendees)),
        h('td', { 'data-label': t('pay.amount') }, h('bdi', null, fmtMoney(r.amount, String(r.currency).trim()))),
        h('td', { class: 'actions', 'data-label': t('common.actions') }, button(t('pay.rate'), async () => { if (await guard(() => setRate(r))) guard(load); }, 'btn small'),
          paid.has(r.staff_id) ? badge(t('pay.paid'), 'ok') : (Number(r.amount) > 0 ? button(t('pay.pay'), () => guard(async () => {
            if (!(await confirmBox(`${t('pay.pay')}: ${r.email} — ${fmtMoney(r.amount, String(r.currency).trim())}؟`))) return;
            const { error: e } = await sb.rpc('pay_trainer_month', { p_club: state.club.id, p_staff: r.staff_id, p_month: from });
            if (e) throw e; toast(t('pay.paidDone'), 'ok'); await load();
          }), 'btn small primary') : null))))))),
      ...[...totals.entries()].map(([c, v]) => h('div', { class: 'kv' }, h('strong', null, `${t('pay.total')} ${c}`), h('strong', null, h('bdi', null, fmtMoney(v, c))))));
  }
  month.addEventListener('change', () => guard(load));
  const overlay = h('div', { class: 'overlay' });
  overlay.append(h('div', { class: 'modal' }, h('h2', null, t('pay.title')), h('label', { class: 'field' }, h('span', null, t('pay.month')), month), out,
    h('p', { class: 'muted small' }, t('pay.help')),
    h('div', { class: 'row end' }, button(t('rep.export'), () => downloadCsv(`payroll-${month.value}.csv`, ['trainer', 'currency', 'events', 'attendees', 'per_event', 'per_attendee', 'amount'],
      rows.map((r) => [r.email, String(r.currency).trim(), r.events, r.attendees, Number(r.per_event) / 10 ** decimals(String(r.currency).trim()), Number(r.per_attendee) / 10 ** decimals(String(r.currency).trim()), Number(r.amount) / 10 ** decimals(String(r.currency).trim())]))), button(t('common.close'), () => overlay.remove(), 'btn primary'))));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  await load();
}
