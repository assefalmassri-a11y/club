# Architecture

## Layout
```
index.html, js/            staff dashboard (entry: js/main.js)
  views/*.js               one module per tab, each exports render(box, ctx)
  dom.js                   h() element builder, forms, toasts, formatting, errText()
  state.js                 in-memory app state (session, club, role, branch)
  i18n.js, lang-en.js      Arabic (default) and English dictionaries, t(key, vars)
  supa.js, config.js       Supabase client and public config
member/                    member app (entry: member/js/main.js), reuses js/dom.js, i18n, supa
door-device/               Node program for the door (card taps + relay)
supabase/migrations/       full DB history (phases 1–27), identical to production; the DB can be rebuilt from it
scripts/                   serve.mjs (dev server), check.mjs (static checks)
tests/                     smoke test + in-memory fake of supabase-js
```

## Rules the code follows
- No framework and no build: plain ES modules loaded by the browser. `supabase-js` comes from a CDN pinned in `js/supa.js` (the tests replace it with `tests/mock-supabase.js`).
- Views build DOM with `h(tag, attrs, ...children)`; never concatenate user data into HTML (CSP also blocks inline styles and scripts).
- Every user-facing string goes through `t('key')`. Both dictionaries must have the same keys (`npm run check` fails otherwise). Keys built dynamically use a template literal with a prefix (`t(\`plat.st.${x}\`)`), which `check` understands.
- Tabs are declared in `TABS` in `js/main.js` (id, group, view, allowed roles). The database is the real authority: the UI only hides what RLS or RPCs would refuse anyway.
- Writes that matter (money, access, audit, subscriptions) go through RPCs (`security definer`, explicit grants), never direct table writes.
- Errors from the database are mapped to friendly messages in `errText()` (`js/dom.js`).

## Data model (summary)
Club → branches → members → memberships (plan, branch scope) and invoices/ledger. Staff roles: owner, branch_manager, trainer, staff. Doors, cards, door attempts and open commands for access. Chat, events, PT bookings, shop, equipment, payroll, coupons. Platform layer (phase 19): `club_plans`, `club_subscriptions`, `platform_admins`, `platform_log`.

Security model: RLS on every table, restrictive no-anonymous policies, MFA (aal2) for sensitive operations, append-only audit log with a hash chain (`verify_audit_chain`), immutable invoices and ledger. Details: project docs `security-hardening` and `docs/FEATURES.md`.

## Door access
Reader → `door-device/door.mjs` signs the tap (HMAC with the door secret) → Edge Function `door-gateway/tap` → `card_tap` (verifies signature, timestamp, card, membership) → `process_door_access` records the attempt and issues an open command → the device pulses the relay. No barcode or QR entry exists.

## Platform layer
Each club has a subscription (trial / active / past_due / suspended) on a plan with branch and member limits, enforced by triggers on `members` and `branches`. Billing is manual: a platform admin (row in `platform_admins`) edits the subscription from the Platform tab. Existing clubs are on `unlimited`.
