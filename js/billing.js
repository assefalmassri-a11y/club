// Calendar-month billing with proration of the first (partial) month.
// Dates are ISO strings (YYYY-MM-DD). Prices are integer minor units.
export function endOfMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
export function calendarTerm(startIso, priceMinor) {
  const end = endOfMonth(startIso);
  const total = Number(end.slice(8));
  const remaining = total - Number(startIso.slice(8)) + 1; // start day counts
  return { ends_on: end, total_days: total, charged_days: remaining, price_minor: Math.round((priceMinor * remaining) / total) };
}
