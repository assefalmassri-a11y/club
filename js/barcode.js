// Code 39 barcode (digits only) as inline SVG. No external library; attributes only (CSP-safe).
const P = { '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', '*': 'nwnnwnwnn' };
export function code39(digits, height = 60) {
  const ns = 'http://www.w3.org/2000/svg';
  const text = `*${String(digits).replace(/[^0-9]/g, '')}*`;
  const N = 2; const W = 5; let x = 10; const bars = [];
  for (const ch of text) {
    const pat = P[ch];
    for (let i = 0; i < 9; i++) {
      const w = pat[i] === 'w' ? W : N;
      if (i % 2 === 0) bars.push([x, w]);
      x += w;
    }
    x += N; // inter-character gap
  }
  const total = x + 10;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${height}`);
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', String(digits));
  svg.setAttribute('class', 'barcode');
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', total); bg.setAttribute('height', height); bg.setAttribute('fill', '#fff');
  svg.append(bg);
  for (const [bx, bw] of bars) {
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', bx); r.setAttribute('y', 0); r.setAttribute('width', bw); r.setAttribute('height', height); r.setAttribute('fill', '#000');
    svg.append(r);
  }
  return svg;
}
