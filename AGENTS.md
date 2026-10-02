<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Hosting

Production is deployed on **Railway** (not Vercel). Use Railway logs/metrics when debugging runtime issues.

## Git workflow

**Auto-push after every build/feature.** After completing any code change that builds cleanly, automatically `git add` + `git commit` + `git push` to `origin/main` without waiting to be asked. Only skip this if the user explicitly says "stop auto push" or "don't push".

## Test copy and checks

A test copy of the app runs on Railway's **Dev** environment (https://storyvenue-backend-dev.up.railway.app) with its own database and fake data. It deploys from `main` on every push. It can never text, email (except approved addresses), charge or notify a real person: see `src/lib/staging.ts`.

- Before pushing: `npx tsc --noEmit`, `npm run lint` (must show 0 errors), `npm test` (fast checks), `npm run build`.
- After pushing: `node scripts/staging/check-deploy.mjs`. It runs the type check, fast checks and lint on a clean checkout of the commit, waits for the test copy to deploy it, then runs the smoke test, the flow tests (`npm run test:flows`) and the browser tests (`npm run test:browser`) against it, and records the result. Report any failure to the user.
- Going live: the live services (StoryVenue Backend, AI Concierge Cron, StoryPay.io Website) deploy from the `production` branch, not `main` (set up Oct 1, 2026). When every check passed, release it without waiting to be asked: run exactly `node scripts/staging/release.mjs <sha>` (no `cd`, no pipes: that's the form the owner's permission rule allows). It moves `production` forward and waits for the live deploy, and refuses a commit that didn't pass. If checks fail, fix, push and check again; never push to `production` any other way. `--skip-checks` is for emergencies, only when the owner says so.
- Database changes: apply to the test copy first.
- Every change comes with a test: a bug fix adds a test that fails without the fix, and a new feature adds or extends a flow test (`tests/flows`) or a browser journey (`tests/browser`). A change with no test isn't finished. A new route that must answer people who aren't signed in goes on the reviewed public list in `tests/flows/locked-doors.test.ts`, with its reason; every other route has to refuse a stranger or that check fails.
- Never copy customer data to the test copy, and never give it live keys.
