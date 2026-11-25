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
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
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

// Platform console shows clubs, plans, admins and the log with a delete action.
{
  const init = `window.__RPC.is_platform_admin=true;window.__RPC.my_club_subscription=${JSON.stringify(sub)};` +
    `window.__RPC.platform_list_clubs=[{club_id:'c9',name:'Alpha Gym',slug:'alpha',plan_code:'starter',status:'trial',trial_ends_on:'2026-12-05',current_period_end:null,notes:null,branches:1,members:3}];` +
    `window.__RPC.platform_list_plans=[{code:'starter',name:'Starter',max_branches:1,max_members:100,price_cents:null,currency:null,active:true}];` +
    `window.__RPC.platform_list_admins=[{user_id:'u1',email:'owner@x.com',created_at:'2026-11-25T10:00:00Z'}];` +
    `window.__RPC.platform_list_log=[{at:'2026-11-25T10:00:00Z',actor_email:'owner@x.com',club_id:null,action:'save_plan',detail:{}}];`;
  const { ctx, page, errors } = await open(init);
  await page.goto(`${base}/`);
  await page.waitForSelector('nav button[data-tab="platform"]');
  await page.evaluate(() => document.querySelector('nav button[data-tab="platform"]').click());
  await page.waitForSelector('.view h3.section');
  const text = await page.$eval('.view', (e) => e.innerText);
  const del = await page.locator('.view button', { hasText: /حذف النادي|Delete club/ }).count();
  if (!/Alpha Gym/.test(text) || !/owner@x.com/.test(text) || del !== 1 || errors.length) fail(`platform console: del=${del} ${errors}`);
  else console.log('ok platform console');
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

// Photo: on a computer the webcam capture dialog opens and a captured photo is saved.
{
  const { ctx, page, errors } = await open();
  await page.goto(`${base}/`);
  await page.waitForSelector('nav button[data-tab="members"]');
  await page.evaluate(() => document.querySelector('nav button[data-tab="members"]').click());
  await page.waitForSelector('.view tbody tr button');
  await page.locator('.view tbody tr button', { hasText: /المزيد|More/ }).first().click();
  await page.locator('.modal button', { hasText: /صورة العضو|Member photo|Photo/ }).first().click();
  await page.waitForSelector('video.cam-video', { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector('video.cam-video').videoWidth > 0, null, { timeout: 8000 });
  await page.locator('.modal button', { hasText: /التقط|Capture/ }).click();
  await page.waitForTimeout(600);
  const calls = await page.evaluate(() => window.__CALLS.filter((c) => c.t === 'members' && c.op === 'update').length);
  if (errors.length || calls < 1) fail(`webcam photo: updates=${calls} ${errors}`); else console.log('ok webcam capture saves the photo');
  await ctx.close();
}

// Invoice print works for an unpaid invoice too.
{
  const { ctx, page, errors } = await open();
  await page.goto(`${base}/`);
  await page.waitForSelector('nav button[data-tab="invoices"]');
  await page.evaluate(() => document.querySelector('nav button[data-tab="invoices"]').click());
  await page.waitForSelector('.view tbody tr button');
  await page.locator('.view tbody tr button', { hasText: /طباعة|Print/ }).first().click();
  const text = await page.$eval('.invoice-doc', (e) => e.innerText);
  if (!/INV-1|1/.test(text) || !/فاتورة|Invoice/.test(text) || errors.length) fail(`invoice print: ${text} ${errors}`);
  else console.log('ok invoice print');
  await ctx.close();
}

// Manager reviews members registered by staff and approves them.
{
  const init = `window.__RPC.members_pending_review=[{id:'m1',member_no:1001,full_name:'Ahmad Test',phone:'0700',branch_id:'b1',created_at:new Date().toISOString(),created_by_email:'desk@x.com'}];window.__RPC.approve_members=1;`;
  const { ctx, page, errors } = await open(init);
  await page.goto(`${base}/`);
  await page.waitForSelector('nav button[data-tab="review"]');
  await page.evaluate(() => document.querySelector('nav button[data-tab="review"]').click());
  await page.waitForSelector('.view tbody tr');
  await page.locator('.view tbody button', { hasText: /اعتماد|Approve/ }).first().click();
  await page.waitForTimeout(400);
  const calls = await page.evaluate(() => window.__CALLS.filter((c) => c.rpc === 'approve_members'));
  if (!calls.length || calls[0].args.p_ids[0] !== 'm1' || errors.length) fail(`review: ${JSON.stringify(calls)} ${errors}`);
  else console.log('ok registration review');
  await ctx.close();
}

// Club branding: the club colour is applied, and the owner can pick a palette colour in Settings.
{
  const init = `window.__DB.clubs[0].brand_color='#4f46e5';window.__RPC.branding_options={palette:['#0d9488','#4f46e5'],allow_custom:true,allow_logo:true};`;
  const { ctx, page, errors } = await open(init);
  await page.goto(`${base}/`);
  await page.waitForSelector('nav button[data-tab="settings"]');
  const pri = await page.evaluate(() => document.documentElement.style.getPropertyValue('--pri'));
  await page.evaluate(() => document.querySelector('nav button[data-tab="settings"]').click());
  await page.waitForSelector('.swatch');
  await page.locator('.swatch').first().click();
  await page.waitForTimeout(400);
  const calls = await page.evaluate(() => window.__CALLS.filter((c) => c.rpc === 'set_club_color'));
  if (pri !== '#4f46e5' || !calls.length || calls[0].args.p_color !== '#0d9488' || errors.length) fail(`branding: pri=${pri} calls=${JSON.stringify(calls)} ${errors}`);
  else console.log('ok club branding');
  await ctx.close();
}

// Club theme: the saved look is applied at start, previews live in Settings and is stored only on Save.
{
  const init = `window.__DB.clubs[0].theme={bg:'warm',font:'classic',fsize:'lg',tabs:'pills'};window.__RPC.branding_options={palette:['#0d9488'],allow_custom:false,allow_logo:false,allow_theme:true};`;
  const { ctx, page, errors } = await open(init);
  await page.goto(`${base}/`);
  await page.waitForSelector('nav button[data-tab="settings"]');
  const attrs = await page.evaluate(() => ['data-bg', 'data-font', 'data-fsize', 'data-tabs'].map((a) => document.documentElement.getAttribute(a)).join());
  await page.evaluate(() => document.querySelector('nav button[data-tab="settings"]').click());
  await page.waitForSelector('select[aria-label]');
  await page.locator('select').filter({ has: page.locator('option[value="mint"]') }).selectOption('mint');
  const live = await page.evaluate(() => document.documentElement.getAttribute('data-bg'));
  await page.locator('.view button', { hasText: /حفظ المظهر|Save look/ }).click();
  await page.waitForTimeout(400);
  const calls = await page.evaluate(() => window.__CALLS.filter((c) => c.rpc === 'set_club_theme'));
  if (attrs !== 'warm,classic,lg,pills' || live !== 'mint' || !calls.length || calls[0].args.p_bg !== 'mint' || calls[0].args.p_tabs !== 'pills' || errors.length) fail(`theme: ${attrs} ${live} ${JSON.stringify(calls)} ${errors}`);
  else console.log('ok club theme');
  await ctx.close();
}

// Member profile opens with details, subscriptions, entries and invoices.
{
  const { ctx, page, errors } = await open();
  await page.goto(`${base}/`);
  await page.waitForSelector('nav button[data-tab="members"]');
  await page.evaluate(() => document.querySelector('nav button[data-tab="members"]').click());
  await page.waitForSelector('.view tbody tr button');
  await page.locator('.view tbody tr button', { hasText: /ملف العضو|Member profile/ }).first().click();
  await page.waitForSelector('.modal.wide h3.section');
  const heads = await page.$$eval('.modal.wide h3.section', (e) => e.length);
  if (heads !== 4 || errors.length) fail(`member profile: sections=${heads} ${errors}`);
  else console.log('ok member profile');
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
