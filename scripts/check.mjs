// Static checks, no dependencies:  node scripts/check.mjs
//  1. syntax of every .js/.mjs file (ES module mode)
//  2. Arabic and English dictionaries have the same keys
//  3. reports unused i18n keys, unreferenced source files and unused imports (warnings only)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['.git', 'node_modules', 'supabase']);
const walk = (d) => readdirSync(d).flatMap((n) => {
  if (SKIP.has(n)) return [];
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(ROOT).filter((f) => /\.(m?js|html)$/.test(f));
const code = files.filter((f) => /\.m?js$/.test(f));
let failed = false;

for (const f of code) {
  const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: readFileSync(f), encoding: 'utf8' });
  if (r.status !== 0) { failed = true; console.error(`SYNTAX ${f}\n${r.stderr}`); }
}

const keysOf = (p) => new Set([...readFileSync(join(ROOT, p), 'utf8').matchAll(/'([a-zA-Z0-9_.]+)':\s*["']/g)].map((m) => m[1]));
const ar = keysOf('js/i18n.js'); const en = keysOf('js/lang-en.js');
for (const k of ar) if (!en.has(k)) { failed = true; console.error(`MISSING in en: ${k}`); }
for (const k of en) if (!ar.has(k)) { failed = true; console.error(`MISSING in ar: ${k}`); }

const text = (f) => readFileSync(f, 'utf8');
const body = files.filter((f) => !/js\/(i18n|lang-en)\.js$/.test(f)).map(text).join('\n');
const prefixes = [...body.matchAll(/`([a-zA-Z0-9_.]+)\.\$\{/g)].map((m) => m[1]);
const unused = [...ar].filter((k) => !body.includes(k) && !prefixes.some((p) => k.startsWith(`${p}.`)));
if (unused.length) console.warn(`warn: ${unused.length} unused i18n keys: ${unused.join(', ')}`);

const ENTRY = new Set(['js/main.js', 'member/js/main.js', 'sw.js', 'member/sw.js', 'door-device/door.mjs']);
for (const f of code) {
  const rel = f.slice(ROOT.length).replace(/\\/g, '/');
  if (ENTRY.has(rel) || rel.startsWith('scripts/') || rel.startsWith('tests/')) continue;
  const b = basename(f);
  if (!files.some((g) => g !== f && new RegExp(`/${b.replace('.', '\\.')}'`).test(text(g)))) console.warn(`warn: unreferenced file ${rel}`);
}

for (const f of code) {
  const src = text(f);
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop();
      if (name && (src.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length < 2) console.warn(`warn: unused import ${name} in ${f.slice(ROOT.length)}`);
    }
  }
}

console.log(failed ? 'check FAILED' : `check ok (${code.length} files, ${ar.size} i18n keys)`);
process.exit(failed ? 1 : 0);
