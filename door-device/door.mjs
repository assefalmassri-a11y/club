// Club door device program (Node 18+, no dependencies).
// Runs on a Raspberry Pi / mini PC at the door. Responsibilities:
//  1. Poll the gateway for QR-scan unlock commands and pulse the relay.
//  2. Send signed card taps (UIDs read from a local reader) and pulse the relay when allowed.
//  3. Serve the rotating QR page to the door screen (secret never leaves this process).
// SAFETY: exit must never depend on this program; keep a mechanical exit / emergency release.
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`Missing env ${k}`); process.exit(1); } return v; };
const DOOR_ID = need('DOOR_ID');
const SECRET = need('DOOR_SECRET');
const GATEWAY = (process.env.GATEWAY_URL || 'https://ufpqzisiguofxtubuujs.supabase.co/functions/v1/door-gateway').replace(/\/$/, '');
const RELAY = process.env.RELAY_MODE || 'log';          // log | shelly | gpio
const OPEN_MS = Math.min(Number(process.env.OPEN_MS || 3000), 10000);
const SCREEN_PORT = Number(process.env.SCREEN_PORT || 8098);
const TAP_PORT = Number(process.env.TAP_PORT || 8099);  // local only: GET /tap?uid=04A1B2C3
const here = dirname(fileURLToPath(import.meta.url));

const hmacHex = (msg) => createHmac('sha256', SECRET).update(msg).digest('hex');
export const doorCode = (step) => hmacHex(String(step)).slice(0, 12);

// ---- relay ----
let relayBusy = false;
async function openDoor() {
  if (relayBusy) return;
  relayBusy = true;
  try {
    console.log(new Date().toISOString(), 'OPEN');
    if (RELAY === 'shelly') {
      const base = need('SHELLY_URL').replace(/\/$/, '');
      await fetch(`${base}/relay/0?turn=on&timer=${Math.ceil(OPEN_MS / 1000)}`, { signal: AbortSignal.timeout(3000) });
    } else if (RELAY === 'gpio') {
      const chip = process.env.GPIO_CHIP || 'gpiochip0'; const line = need('GPIO_LINE');
      await new Promise((res) => { const p = spawn('gpioset', ['-t', String(OPEN_MS), chip, `${line}=1`]); p.on('close', res); p.on('error', res); });
    } else {
      await new Promise((r) => setTimeout(r, OPEN_MS));
    }
  } catch (e) { console.error('relay error', e.message); } finally { relayBusy = false; }
}

async function post(path, body) {
  const r = await fetch(`${GATEWAY}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

// ---- QR unlock commands ----
async function pollClaim() {
  try {
    const ts = Date.now();
    const { status, json } = await post('/claim', { door_id: DOOR_ID, ts, sig: hmacHex(`claim|${DOOR_ID}|${ts}`) });
    if (status === 200 && json.open) openDoor();
    else if (status === 401) console.error('claim rejected (401): check DOOR_SECRET and the device clock (NTP)');
  } catch (e) { console.error('claim error', e.message); }
}
setInterval(pollClaim, 1000);

// ---- card taps ----
let lastTap = 0;
export async function tap(uidRaw) {
  const uid = String(uidRaw).toUpperCase().replace(/[^0-9A-F]/g, '');
  if (!uid || uid.length > 40) return { open: false, reason: 'bad_uid' };
  const ts = Math.max(Date.now(), lastTap + 1); lastTap = ts; // strictly increasing (replay protection)
  try {
    const { status, json } = await post('/tap', { door_id: DOOR_ID, uid, ts, sig: hmacHex(`${DOOR_ID}|${uid}|${ts}`) });
    if (status === 200 && json.open) openDoor();
    return json;
  } catch (e) { console.error('tap error', e.message); return { open: false, reason: 'network' }; }
}
// Reader integrations: pipe UIDs (one per line) on stdin, or call the local HTTP endpoint below.
if (!process.stdin.isTTY) createInterface({ input: process.stdin }).on('line', (l) => { if (l.trim()) tap(l.trim()); });

// ---- local servers (127.0.0.1 only) ----
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/tap' && req.method === 'GET') {
    const r = await tap(u.searchParams.get('uid') || '');
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ open: !!r.open }));
  } else { res.writeHead(404); res.end(); }
}).listen(TAP_PORT, '127.0.0.1');

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/code') {
    const now = Math.floor(Date.now() / 1000); const step = Math.floor(now / 30);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ payload: `club1:${DOOR_ID}:${doorCode(step)}`, ttl: 30 - (now % 30) }));
  } else if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'" });
    res.end(readFileSync(join(here, 'screen.html')));
  } else if (u.pathname === '/vendor/qrcode.js' && existsSync(join(here, 'vendor/qrcode.js'))) {
    res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(readFileSync(join(here, 'vendor/qrcode.js')));
  } else { res.writeHead(404); res.end(); }
}).listen(SCREEN_PORT, '127.0.0.1');

console.log(`door ${DOOR_ID} up. screen http://127.0.0.1:${SCREEN_PORT}/  tap http://127.0.0.1:${TAP_PORT}/tap?uid=…  relay=${RELAY}`);
