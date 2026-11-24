// Exchange rates (club-wide, owner-managed). rate: 1 unit of `from` = rate units of `to`.
import { sb } from './supa.js';
import { state } from './state.js';

let cache = null;
export async function loadRates(force = false) {
  if (cache && !force) return cache;
  const { data } = await sb.from('fx_rates').select('currency_from, currency_to, rate, valid_on').eq('club_id', state.club.id).order('valid_on', { ascending: false }).limit(200);
  const m = new Map();
  for (const r of data || []) { const k = `${r.currency_from}>${r.currency_to}`; if (!m.has(k)) m.set(k, { rate: Number(r.rate), on: r.valid_on }); }
  cache = m; return m;
}
export function clearRates() { cache = null; }
// Convert a minor-unit amount between currencies (decimals come from the caller via exponent factors).
export function convert(rates, from, to, amountMajor) {
  if (from === to) return amountMajor;
  const d = rates.get(`${from}>${to}`); if (d) return amountMajor * d.rate;
  const i = rates.get(`${to}>${from}`); if (i) return amountMajor / i.rate;
  return null;
}
