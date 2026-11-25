// UI smoke test: opens every tab of the staff and member apps in Chrome (Arabic and English)
// against an in-memory fake of supabase-js (tests/mock-supabase.js), and fails on any console error.
//   npm i && npx playwright install chromium   (once)
//   npm test        (CHROME_PATH=/usr/bin/google-chrome to use a system Chrome)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const here = (p) => new URL(p, import.meta.url);
const mock = readFileSync(here('mock-supabase.js'), 'utf8');
const seed = readFileSync(here('seed.js'), 'utf8');
const server = await serve(0);
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let failures = 0;

async function open(init) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(seed);
  if (init) await ctx.addInitScript(init);
  await ctx.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: mock }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { ctx, page, errors };
}
const fail = (msg) => { failures += 1; console.error(`FAIL ${msg}`); };

async function tabs(app, selector, lang) {
  const { ctx, page, errors } = await open(`localStorage.setItem('club.lang','${lang}')`);
  await page.goto(`${base}${app}`);
  await page.waitForSelector(`${selector} button[data-tab]`, { timeout: 8000 });
  const ids = await page.$$eval(`${selector} button[data-tab]`, (b) => b.map((x) => x.dataset.tab));
  for (const id of ids) {
    const before = errors.length;
    await page.evaluate(([s, t]) => document.querySelector(`${s} button[data-tab="${t}"]`).click(), [selector, id]);
    await page.waitForTimeout(300);
    const formError = await page.$$eval('.view .form-error', (e) => e.map((x) => x.textContent.trim()).filter(Boolean));
    if (formError.length || errors.length > before) fail(`${app} [${lang}] tab ${id}: ${[...formError, ...errors.slice(before)].join(' | ')}`);
  }
  console.log(`ok ${app} [${lang}] ${ids.length} tabs`);
  await ctx.close();
}

for (const lang of ['ar', 'en']) {
  await tabs('/', 'nav', lang);
  await tabs('/member/', '.nav', lang);
}

// Platform admin sees the platform tab; a plain owner sees the subscription banner but no platform tab.
const rpc = (o) => `window.__RPC.is_platform_admin=${o.admin};window.__RPC.my_club_subscription=${JSON.stringify(o.sub)};window.__RPC.platform_list_clubs=[];`;
const sub = { plan: 'starter', plan_name: 'Starter', status: 'trial', trial_ends_on: '2026-12-05', max_branches: 1, max_members: 100, branches: 1, members: 2, blocked: null };
for (const [name, admin, wantTab] of [['platform admin', true, true], ['owner', false, false]]) {
  const { ctx, page } = await open(rpc({ admin, sub }));
  await page.goto(`${base}/`);
  await page.waitForSelector('nav button[data-tab]');
  const hasTab = (await page.$('nav button[data-tab="platform"]')) !== null;
  const banner = (await page.$('.notice')) !== null;
  if (hasTab !== wantTab) fail(`${name}: platform tab visible=${hasTab}`);
  if (!banner) fail(`${name}: subscription banner missing`);
  else console.log(`ok ${name}: platform tab=${hasTab}, banner shown`);
  await ctx.close();
}

// Member card print has name and number, no barcode.
{
  const { ctx, page, errors } = await open();
  await page.goto(`${base}/`);
  await page.waitForSelector('nav button[data-tab="members"]');
  await page.evaluate(() => document.querySelector('nav button[data-tab="members"]').click());
  await page.waitForSelector('.view tbody tr button');
  await page.locator('.view tbody tr button', { hasText: /المزيد|More/ }).first().click();
  await page.locator('.modal button', { hasText: /كرت العضوية|Membership card/ }).first().click();
  const text = await page.$eval('.id-card', (e) => e.innerText);
  if (!/#1001/.test(text) || (await page.$('.id-card svg')) || errors.length) fail(`member card: ${text} ${errors}`);
  else console.log('ok member card print');
  await ctx.close();
}

// Member opens a door from the app: control shows for doors with a location and sends the GPS position.
{
  const init = `window.__RPC.my_doors=[{id:'d1',name:'Main door',direction:'in',branch_id:'b1',has_location:true}];window.__RPC.open_door_nearby=[{granted:true,reason:'ok'}];` +
    `navigator.geolocation.getCurrentPosition=(ok)=>ok({coords:{latitude:55.6,longitude:13,accuracy:10}});`;
  const { ctx, page, errors } = await open(init);
  await page.goto(`${base}/member/`);
  await page.waitForSelector('.nav button[data-tab]');
  const btn = page.locator('button', { hasText: /افتح الباب|Open the door/ });
  await btn.first().waitFor({ timeout: 8000 });
  await btn.first().click();
  await page.waitForTimeout(400);
  const calls = await page.evaluate(() => window.__CALLS.filter((c) => c.rpc === 'open_door_nearby'));
  const a = calls[0] && calls[0].args;
  if (!a || a.p_door_id !== 'd1' || a.p_lat !== 55.6 || a.p_accuracy !== 10 || errors.length) fail(`open door: ${JSON.stringify(calls)} ${errors}`);
  else console.log('ok member opens door nearby');
  await ctx.close();
}

// Staff doors tab shows the location column.
{
  const { ctx, page, errors } = await open(`window.__DB.doors=[{id:'d1',club_id:'c1',branch_id:'b1',name:'Main door',active:true,direction:'in',lat:55.6,lng:13,radius_m:40,created_at:'2026-01-01'}];`);
  await page.goto(`${base}/`);
  await page.waitForSelector('nav button[data-tab="doors"]');
  await page.evaluate(() => document.querySelector('nav button[data-tab="doors"]').click());
  await page.waitForTimeout(400);
  const head = await page.$$eval('.view thead th', (e) => e.map((x) => x.textContent.trim()).join('|'));
  const hasBtn = (await page.locator('.view button', { hasText: /تحديد موقع الباب|Set door location/ }).count()) > 0;
  if (!/الموقع|Location/.test(head) || errors.length) fail(`doors location column: ${head} ${errors}`);
  else console.log(`ok staff doors location column (set button: ${hasBtn})`);
  await ctx.close();
}

// Sign-in screens link to the legal pages, and those pages load.
for (const app of ['/', '/member/']) {
  const { ctx, page, errors } = await open('window.__NOSESSION = true');
  await page.goto(`${base}${app}`);
  await page.waitForSelector('.auth-card form');
  const hrefs = await page.$$eval('.auth-card a[href$=".html"]', (a) => a.map((x) => x.pathname));
  if (hrefs.join() !== '/privacy.html,/terms.html' || errors.length) fail(`${app} legal links: ${hrefs} ${errors}`);
  for (const h of hrefs) { const r = await page.request.get(`${base}${h}`); if (r.status() !== 200) fail(`${h} -> ${r.status()}`); }
  console.log(`ok ${app} sign-in legal links`);
  await ctx.close();
}

await browser.close(); server.close();
console.log(failures ? `${failures} FAILED` : 'all smoke tests passed');
process.exit(failures ? 1 : 0);
