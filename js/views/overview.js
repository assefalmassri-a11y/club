import { sb } from '../supa.js';
import { state, scoped, canManage } from '../state.js';
import { h, fmtMoney, fmtDate, fmtDateTime, today, addDays, button, guard, toast } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { loadRates, convert } from '../fx.js';
import { decimals } from '../dom.js';

function tile(label, value, ic, tone = '') {
  return h('div', { class: `tile ${tone}` }, h('span', { class: 'tile-ic' }, icon(ic, 20)), h('div', { class: 'tile-value' }, String(value)), h('div', { class: 'tile-label' }, label));
}

async function count(q) {
  const { count: c, error } = await q;
  if (error) throw error;
  return c ?? 0;
}

export async function render(box) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [inside, checkins, unpaid, overdue, activeMembers] = await Promise.all([
    count(scoped(sb.from('members_inside').select('member_id', { count: 'exact', head: true }))),
    count(scoped(sb.from('checkins').select('id', { count: 'exact', head: true }).gte('checked_in_at', since))),
    count(scoped(sb.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'issued'))),
    count(scoped(sb.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'issued').lt('due_date', today()))),
    count(scoped(sb.from('members').select('id', { count: 'exact', head: true }).eq('status', 'active'))),
  ]);

  box.append(h('div', { class: 'tiles' },
    tile(t('ov.inside'), inside, 'inside', 'ok'),
    tile(t('ov.checkins24'), checkins, 'clock', 'sky'),
    tile(t('ov.members'), activeMembers, 'members', 'indigo'),
    tile(t('ov.unpaid'), unpaid, 'wallet', 'warn'),
    tile(t('ov.overdue'), overdue, 'warn', 'bad')));

  const [{ data: exp }, { data: rec }] = await Promise.all([
    scoped(sb.from('memberships').select('member_id, ends_on').in('status', ['active']).gte('ends_on', today()).lte('ends_on', addDays(today(), 7)).order('ends_on').limit(8)),
    scoped(sb.from('checkins').select('member_id, checked_in_at').order('checked_in_at', { ascending: false }).limit(8), 'branch_id'),
  ]);
  const ids = [...new Set([...(exp || []), ...(rec || [])].map((r) => r.member_id))];
  const names = new Map();
  if (ids.length) { const { data: ms } = await sb.from('members').select('id, full_name').in('id', ids); for (const m of ms || []) names.set(m.id, m.full_name); }
  const col = (title, rows, right) => h('div', null, h('h3', null, title),
    h('div', { class: 'list-simple' }, rows && rows.length ? rows.map((r) => h('div', { class: 'item' }, h('span', null, names.get(r.member_id) || t('common.none')), h('span', { class: 'muted small' }, right(r)))) : h('p', { class: 'muted' }, t('ov.none'))));
  box.append(h('div', { class: 'two-col' }, col(t('ov.expiring'), exp, (r) => fmtDate(r.ends_on)), col(t('ov.recent'), rec, (r) => fmtDateTime(r.checked_in_at))));

  await freezeRequests(box);
  await opsAlerts(box);
  if (canManage()) await alerts(box);

  if (canManage()) {
    const { data, error } = await scoped(sb.from('ledger_totals').select('*'));
    if (!error && data && data.length) {
      // Group by currency; the view is already filtered by RLS.
      const byCur = new Map();
      for (const r of data) {
        const cur = (r.currency || '').trim();
        const acc = byCur.get(cur) || { income: 0, expense: 0 };
        acc.income += Number(r.income_minor ?? r.income ?? 0);
        acc.expense += Number(r.expense_minor ?? r.expense ?? 0);
        byCur.set(cur, acc);
      }
      const base = state.club.default_currency.trim();
      const rates = await loadRates();
      let sum = 0; let complete = byCur.size > 1;
      for (const [cur, v] of byCur) { const major = (v.income - v.expense) / 10 ** decimals(cur); const c = convert(rates, cur, base, major); if (c == null) complete = false; else sum += c; }
      if (byCur.size > 1 && complete) byCur.set('__all', null);
      const combined = byCur.has('__all') ? (byCur.delete('__all'), h('div', { class: 'tile wide' }, h('div', { class: 'tile-label' }, `${t('fx.combined')} (${base})`), h('div', { class: 'tile-value small' }, h('bdi', null, fmtMoney(Math.round(sum * 10 ** decimals(base)), base))), h('div', { class: 'muted small' }, t('fx.approx')))) : null;
      box.append(h('h3', null, t('ov.totals')), h('div', { class: 'tiles' }, combined, ...[...byCur.entries()].map(([cur, v]) =>
        h('div', { class: 'tile wide' },
          h('div', { class: 'tile-label' }, cur),
          h('div', null, `${t('ov.income')}: `, h('bdi', null, fmtMoney(v.income, cur))),
          h('div', null, `${t('ov.expense')}: `, h('bdi', null, fmtMoney(v.expense, cur))),
          h('div', { class: 'tile-value small' }, `${t('ov.balance')}: `, h('bdi', null, fmtMoney(v.income - v.expense, cur)))))));
    }
  }
  return null;
}

// Owner/manager alerts: lapsed this week, quiet for 14 days, overdue invoices.
async function alerts(box) {
  const td = today();
  const since14 = new Date(Date.now() - 14 * 86400000).toISOString();
  const [{ data: lapsed }, { data: covering }, { data: recent }, { data: late }] = await Promise.all([
    scoped(sb.from('memberships').select('member_id, ends_on').in('status', ['active', 'expired']).gte('ends_on', addDays(td, -7)).lt('ends_on', td).order('ends_on', { ascending: false }).limit(200)),
    scoped(sb.from('memberships').select('member_id').eq('status', 'active').lte('starts_on', td).gte('ends_on', td).limit(1000)),
    scoped(sb.from('checkins').select('member_id').gte('checked_in_at', since14).limit(5000)),
    scoped(sb.from('invoices').select('member_id, due_date, amount_minor, currency').eq('status', 'issued').lt('due_date', td).order('due_date').limit(8)),
  ]);
  const coveredSet = new Set((covering || []).map((r) => r.member_id));
  const lapsedRows = []; const seen = new Set();
  for (const r of lapsed || []) if (!coveredSet.has(r.member_id) && !seen.has(r.member_id)) { seen.add(r.member_id); lapsedRows.push(r); }
  const came = new Set((recent || []).map((r) => r.member_id));
  const quiet = [...coveredSet].filter((id) => !came.has(id)).slice(0, 8).map((id) => ({ member_id: id }));
  const ids = [...new Set([...lapsedRows.slice(0, 8), ...quiet, ...(late || [])].map((r) => r.member_id))];
  const names = new Map();
  if (ids.length) { const { data: ms } = await sb.from('members').select('id, member_no, full_name').in('id', ids); for (const m of ms || []) names.set(m.id, m); }
  const nm = (id) => { const m = names.get(id); return m ? `${m.full_name} #${m.member_no}` : t('common.none'); };
  const col = (title, rows, right) => h('div', null, h('h3', null, `${title} (${rows.length})`),
    h('div', { class: 'list-simple' }, rows.length ? rows.slice(0, 8).map((r) => h('div', { class: 'item' }, h('span', null, nm(r.member_id)), h('span', { class: 'muted small' }, right(r)))) : h('p', { class: 'muted' }, t('ov.none'))));
  const { data: reqs } = await sb.from('data_requests').select('member_id, created_at').eq('club_id', state.club.id).is('done_at', null).limit(10);
  const rids = (reqs || []).map((r) => r.member_id);
  if (rids.length) { const { data: ms } = await sb.from('members').select('id, member_no, full_name').in('id', rids); for (const m of ms || []) names.set(m.id, m); }
  box.append(h('h3', { class: 'section' }, t('ov.alerts')),
    h('div', { class: 'two-col' }, col(t('ov.lapsed'), lapsedRows, (r) => fmtDate(r.ends_on)), col(t('ov.quiet'), quiet, () => t('ov.quiet14'))),
    h('div', { class: 'list-simple' }, h('h3', null, `${t('ov.lateInv')} (${(late || []).length})`),
      (late || []).length ? late.map((r) => h('div', { class: 'item' }, h('span', null, nm(r.member_id)), h('span', { class: 'muted small' }, `${fmtDate(r.due_date)} · `, h('bdi', null, fmtMoney(r.amount_minor, String(r.currency).trim()))))) : h('p', { class: 'muted' }, t('ov.none'))));
  if (rids.length) {
    box.append(h('div', { class: 'list-simple' }, h('h3', null, `${t('ov.deleteReq')} (${rids.length})`),
      rids.map((id) => h('div', { class: 'item' }, h('span', null, nm(id)), h('span', { class: 'muted small' }, t('ov.deleteReqHelp'))))));
  }
}

// Pending self-service freeze requests (approve / reject).
async function freezeRequests(box) {
  const { data, error } = await scoped(sb.from('freeze_requests').select('id, member_id, reason, kind, requested_at').eq('status', 'pending').order('requested_at').limit(20));
  if (error || !data || !data.length) return;
  const { data: ms } = await sb.from('members').select('id, full_name, member_no').in('id', data.map((r) => r.member_id));
  const nm = new Map((ms || []).map((m) => [m.id, m]));
  const wrap = h('div', { class: 'list-simple' }, h('h3', null, `${t('frz.pending')} (${data.length})`));
  for (const r of data) {
    const m = nm.get(r.member_id) || {};
    const row = h('div', { class: 'item' }, h('span', null, `${m.full_name || ''} #${m.member_no || ''} · ${t(r.kind === 'resume' ? 'frz.kindResume' : 'frz.kindFreeze')}`, r.reason ? h('div', { class: 'muted small' }, r.reason) : null),
      h('span', { class: 'row gap' }, ...[[true, 'frz.approve', 'btn small primary'], [false, 'frz.reject', 'btn small']].map(([ok, k, c]) => button(t(k), () => guard(async () => {
        const { error: e } = await sb.rpc('decide_freeze', { p_id: r.id, p_approve: ok }); if (e) throw e; row.remove(); toast(t('frz.done'), 'ok');
      }), c))));
    wrap.append(row);
  }
  box.append(wrap);
}

// Low stock and equipment problems.
async function opsAlerts(box) {
  const [{ data: prods }, { data: eqs }] = await Promise.all([
    scoped(sb.from('products').select('name, stock, low_stock').eq('active', true).limit(300)),
    scoped(sb.from('equipment').select('name, status, next_service').limit(300)),
  ]);
  const low = (prods || []).filter((p) => p.stock <= p.low_stock);
  const bad = (eqs || []).filter((e) => e.status !== 'ok' || (e.next_service && e.next_service < today()));
  if (!low.length && !bad.length) return;
  const wrap = h('div', { class: 'two-col' });
  if (low.length) wrap.append(h('div', { class: 'list-simple' }, h('h3', null, `${t('ov.lowStock')} (${low.length})`), low.slice(0, 8).map((p) => h('div', { class: 'item' }, h('span', null, p.name), h('span', { class: 'muted small' }, String(p.stock))))));
  if (bad.length) wrap.append(h('div', { class: 'list-simple' }, h('h3', null, `${t('ov.eqIssues')} (${bad.length})`), bad.slice(0, 8).map((e) => h('div', { class: 'item' }, h('span', null, e.name), h('span', { class: 'muted small' }, e.status !== 'ok' ? t(`eq.s.${e.status}`) : t('eq.serviceDue'))))));
  box.append(wrap);
}
