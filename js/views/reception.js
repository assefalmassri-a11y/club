import { sb } from '../supa.js';
import { scoped, currency } from '../state.js';
import { h, clear, badge, fmtDateTime, fmtMoney, today } from '../dom.js';
import { t } from '../i18n.js';
import { avatar } from '../photo.js';

export async function render(box) {
  const list = h('div', { class: 'list' });
  const stamp = h('span', { class: 'muted small' });
  box.append(h('div', { class: 'row between wrap' }, h('h2', null, t('rec.title')), stamp), list);

  async function load() {
    const { data: ins, error } = await scoped(sb.from('members_inside').select('member_id, checked_in_at, branch_id').order('checked_in_at', { ascending: false }).limit(200));
    if (error) throw error;
    const rows = ins || [];
    const ids = [...new Set(rows.map((r) => r.member_id))];
    const names = new Map(); const covered = new Set(); const overdue = new Map();
    if (ids.length) {
      const [{ data: ms }, { data: sub }, { data: inv }] = await Promise.all([
        sb.from('members').select('id, member_no, full_name, photo_path').in('id', ids),
        sb.from('memberships').select('member_id').in('member_id', ids).eq('status', 'active').lte('starts_on', today()).gte('ends_on', today()),
        sb.from('invoices').select('member_id, amount_minor, currency').in('member_id', ids).eq('status', 'issued').lt('due_date', today()),
      ]);
      for (const m of ms || []) names.set(m.id, m);
      for (const s of sub || []) covered.add(s.member_id);
      for (const i of inv || []) overdue.set(i.member_id, (overdue.get(i.member_id) || 0) + 1);
    }
    const cards = rows.map((r) => {
      const m = names.get(r.member_id) || {};
      const flags = [];
      if (!covered.has(r.member_id)) flags.push(badge(t('rec.noSub'), 'bad'));
      if (overdue.has(r.member_id)) flags.push(badge(`${t('rec.overdue')} ×${overdue.get(r.member_id)}`, 'warn'));
      return { flagged: flags.length, node: h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('span', { class: 'row gap' }, avatar(m.photo_path, m.full_name, 'lg'), h('strong', null, m.full_name || '—')), h('span', { class: 'muted ltr' }, m.member_no ? `#${m.member_no}` : '')),
        h('div', { class: 'row between wrap' }, h('span', { class: 'muted small' }, fmtDateTime(r.checked_in_at)), h('span', { class: 'row gap' }, flags))) };
    }).sort((a, b) => b.flagged - a.flagged);
    clear(list);
    if (!cards.length) list.append(h('p', { class: 'muted' }, t('rec.empty')));
    for (const c of cards) list.append(c.node);
    stamp.textContent = `${t('rec.inside')}: ${cards.length} · ${new Date().toLocaleTimeString()}`;
  }
  await load();
  const timer = setInterval(() => { load().catch(() => {}); }, 20000);
  return () => clearInterval(timer);
}
