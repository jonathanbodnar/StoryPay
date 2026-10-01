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

- Before pushing: `npx tsc --noEmit`, eslint on changed files, `npm test` (fast checks), `npm run build`.
- After pushing: `node scripts/staging/check-deploy.mjs`. It waits for the test copy to deploy the commit, then runs the smoke test, the flow tests (`npm run test:flows`) and the browser tests (`npm run test:browser`) against it. Report any failure to the user.
- Report-only for now: production still deploys from `main`. Later, production will deploy from a `production` branch that is only moved after these checks pass.
- Database changes: apply to the test copy first.
- Never copy customer data to the test copy, and never give it live keys.
