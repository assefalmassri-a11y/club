// Class ratings report and stored monthly reports.
import { sb } from '../supa.js';
import { state } from '../state.js';
import { h, clear, button, toast, guard, fmtMoney, fmtDateTime, openForm } from '../dom.js';
import { t, locale } from '../i18n.js';

export async function openRatings() {
  const to = new Date(); const from = new Date(Date.now() - 90 * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const { data, error } = await sb.rpc('ratings_report', { p_club: state.club.id, p_from: iso(from), p_to: iso(to) });
  if (error) throw error;
  const overlay = h('div', { class: 'overlay' });
  overlay.append(h('div', { class: 'modal' }, h('h2', null, t('rt.title')),
    (data || []).length ? h('div', { class: 'list-simple' }, data.map((r) => h('div', { class: 'item' },
      h('span', null, h('strong', null, r.title), h('div', { class: 'muted small' }, fmtDateTime(r.starts_at))),
      h('span', null, `${'★'.repeat(Math.round(Number(r.avg_stars)))} `, h('bdi', null, `${r.avg_stars} (${r.votes})`))))) : h('p', { class: 'muted' }, t('common.empty')),
    h('p', { class: 'muted small' }, t('rt.note')),
    h('div', { class: 'row end' }, button(t('common.close'), () => overlay.remove(), 'btn primary'))));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}

export async function openMonthly() {
  const overlay = h('div', { class: 'overlay print-overlay' }); const body = h('div');
  async function load() {
    clear(body);
    const { data, error } = await sb.from('monthly_reports').select('period, data').eq('club_id', state.club.id).order('period', { ascending: false }).limit(12);
    if (error) throw error;
    if (!(data || []).length) { body.append(h('p', { class: 'muted' }, t('mr.none'))); return; }
    for (const r of data) {
      const d = r.data || {};
      body.append(h('div', { class: 'card-box' }, h('h3', null, new Date(`${r.period}T00:00:00`).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })),
        ...(d.finance || []).map((f) => h('div', { class: 'kv' }, h('span', null, `${f.currency}: ${t('ov.income')} / ${t('ov.expense')}`), h('bdi', null, `${fmtMoney(f.income || 0, f.currency)} / ${fmtMoney(f.expense || 0, f.currency)}`))),
        h('div', { class: 'kv' }, h('span', null, t('mr.newMembers')), h('strong', null, String(d.new_members ?? 0))),
        h('div', { class: 'kv' }, h('span', null, t('rep.visits')), h('strong', null, String(d.visits ?? 0))),
        h('div', { class: 'kv' }, h('span', null, t('mr.newSubs')), h('strong', null, String(d.new_memberships ?? 0))),
        h('div', { class: 'kv' }, h('span', null, t('mr.lapsed')), h('strong', null, String(d.lapsed ?? 0))),
        h('div', { class: 'kv' }, h('span', null, t('mr.classes')), h('strong', null, `${d.classes ?? 0} · ${d.attendees ?? 0}`))));
    }
  }
  overlay.append(h('div', { class: 'modal' }, h('h2', null, t('mr.title')), body,
    h('div', { class: 'row end' },
      button(t('mr.generate'), () => guard(async () => {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
        const { error } = await sb.rpc('generate_monthly_report', { p_club: state.club.id, p_period: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` });
        if (error) throw error; toast(t('mr.done'), 'ok'); await load();
      })),
      button(t('mem.print'), () => window.print()), button(t('common.close'), () => overlay.remove(), 'btn primary'))));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  await load();
}
