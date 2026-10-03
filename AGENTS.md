<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Hosting

Production is deployed on **Railway** (not Vercel). Use Railway logs/metrics when debugging runtime issues.

## Git workflow

**Auto-push after every build/feature.** After completing any code change that builds cleanly, automatically `git add` + `git commit` + `git push` to `origin/main` without waiting to be asked. Only skip this if the user explicitly says "stop auto push" or "don't push".

## Test copy and checks

A test copy of the app runs on Railway's **Dev** environment (https://storyvenue-backend-dev.up.railway.app) with its own database and fake data. It deploys from `main` on every push. It can never text, email (except approved addresses), charge or notify a real person: see `src/lib/staging.ts`. Texting, received email, Tripleseat, Event Temple, Calendly and Google Calendar are answered there by stand-ins that record what was sent (`/api/staging/sms`, `/api/staging/outbox`, `/api/staging/integrations`), so their flows can be tested.

- Before pushing: `npx tsc --noEmit`, `npm run lint` (must show 0 errors), `npm test` (fast checks), `npm run build`.
- Going live — **hot is the default** (owner's call, Oct 3, 2026; they want changes live fast without asking). The live services (StoryVenue Backend, AI Concierge Cron, StoryPay.io Website) deploy from the `production` branch, not `main`. After pushing to `main`, immediately run exactly `node scripts/staging/release.mjs <sha> --hot` (no `cd`, no pipes: that's the form the owner's permission rule allows), then start `node scripts/staging/trailing-check.mjs <sha>` in the background — it runs the full check against the test copy and records the verdict.
- If the trailing check fails: **fix forward** — the change stays live while the fix is written, tested where it failed, and released hot over it. Roll production back instead (`node scripts/staging/rollback.mjs <sha>`, ~1 minute, no rebuild) when the failure is hurting real pages or a fix isn't ready within ~15 minutes. Never leave a red trailing check unresolved, and always tell the owner what failed and what was done.
- The sensitive areas always take the full gate first — `release.mjs --hot` refuses them (payments, texting/automated messages, sign-in, migrations and dependency changes; the list lives in `scripts/staging/lanes.mjs`). For those: `node scripts/staging/check-deploy.mjs <sha>` (code checks first, a failure stops everything; then the changed area's flow tests, smoke, every flow test, browser tests, stopping at the first failing stage; commits that ship nothing take its smoke lane), then release with `node scripts/staging/release.mjs <sha>` once it passes. `--skip-checks` is for emergencies, only when the owner says so. Never push to `production` any other way.
- Database changes: apply to the test copy first.
- Every change comes with a test: a bug fix adds a test that fails without the fix, and a new feature adds or extends a flow test (`tests/flows`) or a browser journey (`tests/browser`). A change with no test isn't finished. A new route that must answer people who aren't signed in goes on the reviewed public list in `tests/flows/locked-doors.test.ts`, with its reason; every other route has to refuse a stranger or that check fails.
- Never copy customer data to the test copy, and never give it live keys.
