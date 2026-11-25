// Inline SVG icons (stroke style). Built with DOM APIs, no innerHTML.
const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  overview: ['M3 12 12 3l9 9', 'M5 10v10h14V10'],
  members: ['M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1', 'M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7', 'M21 19v-1a4 4 0 0 0-3-3.9', 'M16 3.2a3.5 3.5 0 0 1 0 6.6'],
  invoices: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  reception: ['M3 5h18v10H3z', 'M8 19h8', 'M12 15v4'],
  audit: ['M6 3h9l4 4v14H6z', 'M14 3v5h5', 'M9 13h7', 'M9 17h7'],
  platform: ['M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z'],
  events: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  chat: ['M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z'],
  inside: ['M15 3h4v18h-4', 'M10 8l4 4-4 4', 'M14 12H3'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18', 'M12 7v5l3 2'],
  warn: ['M12 3 2 20h20z', 'M12 10v4', 'M12 17h.01'],
  wallet: ['M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M3 7l2-3h12', 'M16 14h2'],
  logout: ['M9 21H5V3h4', 'M16 8l4 4-4 4', 'M20 12H9'],
  plus: ['M12 5v14', 'M5 12h14'],
  ledger: ['M4 19V5', 'M4 19h16', 'M8 15l3-4 3 2 4-6'],
  doors: ['M6 21V4h12v17', 'M4 21h16', 'M14 12h.01'],
  staff: ['M3 5h18v14H3z', 'M8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4', 'M5 16c.5-2 5.5-2 6 0', 'M14 9h5', 'M14 13h5'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9c.6.5 1.3.9 2 1.2L10 21h4l.6-2.6c.7-.3 1.4-.7 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z'],
  reports: ['M5 20V10', 'M12 20V4', 'M19 20v-7'],
  clients: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M4 21c0-4 4-6 8-6s8 2 8 6'],
  coach: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M4 21c0-4 4-6 8-6s8 2 8 6'],
  analytics: ['M4 20V10', 'M10 20V4', 'M16 20v-8', 'M22 20H2'],
  shop: ['M5 8h14l-1 12H6z', 'M9 8V6a3 3 0 0 1 6 0v2'],
  equipment: ['M6 8v8', 'M18 8v8', 'M3 10v4', 'M21 10v4', 'M6 12h12'],
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
