<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Hosting

Production is deployed on **Railway** (not Vercel). Use Railway logs/metrics when debugging runtime issues.

## Git workflow

**Auto-push after every build/feature.** After completing any code change that builds cleanly, automatically `git add` + `git commit` + `git push` to `origin/main` without waiting to be asked. Only skip this if the user explicitly says "stop auto push" or "don't push".
