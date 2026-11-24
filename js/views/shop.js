// Small shop / POS: products with stock, sales recorded to the ledger as income.
import { sb } from '../supa.js';
import { state, scoped, canManage } from '../state.js';
import { h, clear, badge, button, openForm, toast, guard, fmtMoney, toMinor, decimals } from '../dom.js';
import { t } from '../i18n.js';

export async function render(box) {
  const list = h('div', { class: 'table-wrap' });
  box.append(h('div', { class: 'row between wrap' }, h('h2', null, t('shop.title')),
    canManage() ? button(t('shop.add'), async () => { if (await guard(() => editProduct(null))) load(); }, 'btn primary') : null), list);

  async function editProduct(p) {
    const cur = p ? String(p.currency).trim() : state.club.default_currency.trim(); const d = decimals(cur);
    const ok = await openForm({
      title: p ? p.name : t('shop.add'),
      fields: [
        { name: 'branch', label: t('common.branch'), type: 'select', required: true, options: state.branches.map((b) => ({ value: b.id, label: b.name })), value: p ? p.branch_id : (state.branchId || (state.branches[0] && state.branches[0].id)) },
        { name: 'name', label: t('shop.name'), required: true, maxlength: 80, value: p ? p.name : '' },
        { name: 'price', label: `${t('shop.price')} (${cur})`, required: true, inputmode: 'decimal', dir: 'ltr', value: p ? String(Number(p.price_minor) / 10 ** d) : '' },
        { name: 'stock', label: t('shop.stock'), required: true, inputmode: 'numeric', dir: 'ltr', value: p ? String(p.stock) : '0' },
        { name: 'low', label: t('shop.low'), required: true, inputmode: 'numeric', dir: 'ltr', value: p ? String(p.low_stock) : '5' },
        { name: 'active', label: t('shop.active'), type: 'select', options: [{ value: '1', label: t('shop.yes') }, { value: '0', label: t('shop.no') }], value: p && !p.active ? '0' : '1' },
      ],
      onSubmit: async (v) => {
        const price = toMinor(v.price, cur); const stock = Number(v.stock); const low = Number(v.low);
        if (price === null || !Number.isInteger(stock) || stock < 0 || !Number.isInteger(low) || low < 0) throw new Error(t('err.invalid'));
        const { error } = await sb.rpc('save_product', { p_id: p ? p.id : null, p_branch: v.branch, p_name: v.name, p_price: price, p_currency: cur, p_stock: stock, p_low: low, p_active: v.active === '1' });
        if (error) throw error;
      },
    });
    if (ok === true) toast(t('shop.saved'), 'ok');
    return ok === true;
  }

  async function sell(p) {
    const cur = String(p.currency).trim();
    const ok = await openForm({
      title: `${t('shop.sell')}: ${p.name}`,
      fields: [
        { name: 'qty', label: t('shop.qty'), required: true, inputmode: 'numeric', dir: 'ltr', value: '1' },
        { name: 'method', label: t('inv.method'), type: 'select', required: true, options: ['cash', 'transfer', 'card', 'other'].map((m) => ({ value: m, label: t(`inv.m.${m}`) })), value: 'cash' },
      ],
      onSubmit: async (v) => {
        const q = Number(v.qty); if (!Number.isInteger(q) || q < 1) throw new Error(t('err.invalid'));
        const { error } = await sb.rpc('sell_product', { p_product: p.id, p_qty: q, p_member: null, p_method: v.method });
        if (error) throw error;
        toast(`${t('shop.sold')}: ${fmtMoney(Number(p.price_minor) * q, cur)}`, 'ok');
      },
    });
    return ok === true;
  }

  async function load() {
    clear(list);
    const { data, error } = await scoped(sb.from('products').select('id, branch_id, name, price_minor, currency, stock, low_stock, active').order('name').limit(300));
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) { list.append(h('p', { class: 'muted' }, t('common.empty'))); return; }
    list.append(h('table', { class: 'grid' },
      h('thead', null, h('tr', null, [t('shop.name'), t('shop.price'), t('shop.stock'), t('common.actions')].map((c) => h('th', null, c)))),
      h('tbody', null, rows.map((p) => h('tr', null,
        h('td', { 'data-label': t('shop.name') }, h('strong', null, p.name), p.active ? null : h('span', { class: 'muted small' }, ` (${t('shop.no')})`)),
        h('td', { 'data-label': t('shop.price') }, h('bdi', null, fmtMoney(p.price_minor, String(p.currency).trim()))),
        h('td', { 'data-label': t('shop.stock') }, p.stock <= p.low_stock ? badge(`${p.stock} ⚠`, p.stock === 0 ? 'bad' : 'warn') : String(p.stock)),
        h('td', { class: 'actions', 'data-label': t('common.actions') },
          p.active && p.stock > 0 ? button(t('shop.sell'), async () => { if (await guard(() => sell(p))) load(); }, 'btn small primary') : null,
          canManage() ? button(t('shop.edit'), async () => { if (await guard(() => editProduct(p))) load(); }, 'btn small') : null))))));
  }
  await load();
  return null;
}
