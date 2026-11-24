// Inline SVG icons (stroke style). Built with DOM APIs, no innerHTML.
const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  overview: ['M3 12 12 3l9 9', 'M5 10v10h14V10'],
  members: ['M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1', 'M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7', 'M21 19v-1a4 4 0 0 0-3-3.9', 'M16 3.2a3.5 3.5 0 0 1 0 6.6'],
  invoices: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'],
  events: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  chat: ['M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z'],
  inside: ['M15 3h4v18h-4', 'M10 8l4 4-4 4', 'M14 12H3'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18', 'M12 7v5l3 2'],
  warn: ['M12 3 2 20h20z', 'M12 10v4', 'M12 17h.01'],
  wallet: ['M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M3 7l2-3h12', 'M16 14h2'],
  qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h2v2h-2z', 'M18 14h2v6h-4', 'M14 18h2'],
  logout: ['M9 21H5V3h4', 'M16 8l4 4-4 4', 'M20 12H9'],
  plus: ['M12 5v14', 'M5 12h14'],
  card: ['M3 6h18v12H3z', 'M3 10h18'],
};
export function icon(name, size = 20) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  for (const d of PATHS[name] || []) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
