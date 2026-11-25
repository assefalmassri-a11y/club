# Development

## Daily commands
```
npm run serve     # dev server on :8080
npm run check     # syntax, ar/en parity, unused keys/files
npm test          # smoke test (needs: npm i && npx playwright install chromium)
```
CHROME_PATH=/path/to/chrome makes the tests use a system Chrome.

## Add a staff tab
1. Create `js/views/<name>.js` exporting `async function render(box, ctx)` (return a cleanup function or null).
2. Add it to `TABS` in `js/main.js` with its group and roles; add an icon in `js/icons.js` if needed.
3. Add `tab.<name>` and the view's keys to **both** `js/i18n.js` and `js/lang-en.js`.
4. Add seed rows for the tables it reads in `tests/seed.js`, then run `npm run check && npm test`.

## Add or change text
Add the key to `js/i18n.js` (Arabic) and `js/lang-en.js` (English). `npm run check` reports missing keys and unused ones.

## Database changes
- Write a migration in `supabase/migrations/<date>_<phase>_<name>.sql`: tables with RLS enabled and explicit `revoke`/`grant`, functions as `security definer` with `set search_path = ''`.
- Test it first on a local Postgres (stub `auth.uid()`, roles `anon`/`authenticated`), including: the allowed role works, the other roles are refused, anonymous is refused.
- Apply it to Supabase, then document the phase in the project docs.

## The test harness
`tests/mock-supabase.js` is an in-memory fake of the supabase-js calls the app uses (`from().select/insert/update/delete`, filters, `rpc`, `auth`, `storage`). `tests/seed.js` fills it; set `window.__RPC.<name>` to stub an RPC result. It checks that screens render and that nothing logs a console error. It does not test database logic, RLS or the real login.
