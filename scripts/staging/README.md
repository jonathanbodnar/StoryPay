# The test copy (staging)

A copy of the app on Railway's **Dev** environment, <https://storyvenue-backend-dev.up.railway.app>, with its own Supabase project (`storyvenue-staging`) and fake data only. It deploys from `main` on every push. `src/lib/staging.ts` keeps it from reaching anyone: email only to `STAGING_EMAIL_ALLOWLIST` (marked [TEST]), no texts, push, Slack, LunarPay or live keys, and a password page (`STAGING_PASSWORD`).

## Scripts

All run with the test copy's settings: `railway run --service "StoryVenue Backend" --environment Dev -- <command>`.

| Script | What it does |
|---|---|
| `node scripts/staging/configure-railway.mjs --apply` | Sets the Dev settings from the `STAGING_*` values plus a fixed list copied from production. Values never printed. |
| `node scripts/staging/setup-db.mjs` | Copies the live database's structure (no rows) into the test database, plus the storage buckets. |
| `node scripts/staging/seed.mjs` | Product settings from live, the demo venue (Maple Hollow Barn) and fake leads. Safe to rerun. |
| `npx tsx --tsconfig ./tsconfig.json scripts/staging/stripe-webhooks.ts` | Points Stripe's test-mode webhooks at the test copy; saves their secrets to Railway Dev. |
| `node scripts/staging/smoke.mjs` | Quick check: password page, sign-in, dashboard, leads. |
| `node scripts/staging/check-deploy.mjs` | Run plainly after a push: code checks first (a failure stops everything), then waits for the test copy to deploy the commit and runs the changed area's flow tests, the smoke, flow and browser tests — stopping at the first failure — and records the result. A commit that ships nothing (scripts/tests/docs only) runs the smoke lane (`scripts/staging/lanes.mjs` holds the rules). |
| `node scripts/staging/release.mjs <sha>` | Puts a commit live (moves `production` to it), only if it passed the checks; waits for the live deploy. |
| `node scripts/staging/setup-gate.mjs` | One time (done Oct 1, 2026): the live services release from `production`. |

Flow tests: `npm run test:flows`. Browser tests: `npm run test:browser`.

## One manual step: the test venue's Stripe sign-up

Couple payment tests (`tests/flows/payments.test.ts`) need the **Flow Test Venue** connected to Stripe in test mode. Stripe's sign-up form is behind a CAPTCHA, so a person does it once:

1. Open the test copy and sign in as `flow-owner@example.com` with `STAGING_PASSWORD`.
2. Open `/dashboard/payments/settings` and click **Continue setup** (or **Connect with Stripe**).
3. Fill in Stripe's form with its test values (a "Use test data" button, where Stripe shows one, does the same): phone `000 000 0000`, code `000000`, date of birth `01/01/1901`, SSN `000-00-0000` (or last four `0000`), address line `address_full_match`, bank routing `110000000`, account `000123456789`.
4. Finish and return to the app. The tests run from then on.

## Going live

The live site (StoryVenue Backend, the AI Concierge job, the StoryPay.io website) deploys from the `production` branch; the test copy from `main`.

1. Push to `main`: the test copy updates, the live site doesn't.
2. `node scripts/staging/check-deploy.mjs`: every check against the test copy.
3. `node scripts/staging/release.mjs <sha>`: if it passed, it goes live.

Emergencies only, when the owner says so: `release.mjs <sha> --skip-checks`. To undo a release, revert the change on `main`, check, and release again (or redeploy the previous version from Railway).

Texting on the test copy goes to a stand-in (`src/lib/staging-ghl.ts`): `GET /api/staging/sms` lists the texts it would have sent, `POST` plays a couple texting back.
