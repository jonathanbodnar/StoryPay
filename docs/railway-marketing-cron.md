# Marketing email cron on Railway

Campaigns and automations advance only when something successfully calls:

`GET /api/cron/marketing-email`

with `Authorization: Bearer <MARKETING_CRON_SECRET>` or `?secret=<same>`.

`vercel.json` in this repo is **ignored by Railway**. You must schedule that HTTP request yourself.

---

## Do **not** point Railway Cron at your main Next.js service

Railway’s cron feature runs the service **start command** on a schedule and expects a process that **exits**. A normal StoryPay web service runs `next start` and **never exits**, so the next cron run can be skipped or behave badly. Use one of the options below instead.

---

## Option A — GitHub Actions (recommended, already in the repo)

The workflow `.github/workflows/marketing-email-cron.yml` runs every **5 minutes** and `curl`s your live app.

### You do this once

1. Open your repo on **GitHub** → **Settings** → **Secrets and variables** → **Actions**.
2. Under **Repository secrets**, click **New repository secret** and add:

| Name | Value |
|------|--------|
| `MARKETING_CRON_URL` | Your public app origin only, e.g. `https://something.up.railway.app` (no path, no trailing slash required). |
| `MARKETING_CRON_SECRET` | The **same** string as `MARKETING_CRON_SECRET` or `CRON_SECRET` on Railway. |

3. Commit and push the workflow file if it is not already on `main` (it lives in `.github/workflows/`).

4. Confirm: **Actions** tab → **Marketing email cron** → open a run → it should succeed (green). Use **Run workflow** to test immediately.

No extra Railway service or cost beyond GitHub’s free tier limits.

---

## Option B — Separate Railway service (“cron worker”)

Use a **second** service in the **same** Railway project, same GitHub repo, whose only job is to run the script and exit.

### You do this in Railway

1. In your project, click **\+ New** → **GitHub Repo** → select **StoryPay** again (or **Empty** and attach the repo — whichever Railway shows for a second service from the same repo).

2. Open the **new** service → **Settings**:

   - **Service name:** e.g. `storypay-marketing-cron`.

   - **Start command** (or “Custom start command”, depending on UI):

     ```bash
     npm run cron:marketing-email
     ```

   - **Variables:** add the same values as your web app for:

     - `MARKETING_CRON_SECRET` or `CRON_SECRET`
     - `MARKETING_CRON_BASE_URL` **or** `NEXT_PUBLIC_APP_URL` **or** rely on `RAILWAY_PUBLIC_DOMAIN` if Railway injects it for this service (the Node script supports all three).

   - **Cron schedule** (same Settings area, if available): `*/5 * * * *` (UTC). Railway’s minimum is often every 5 minutes.

3. **Deploy** the cron service. Each scheduled run should log one HTTP response and exit.

**Note:** Nixpacks may still run `npm run build` for this service (full Next build). If that is too slow or expensive, prefer **Option A** (GitHub Actions) or a minimal external ping (Option C).

---

## Option C — One-off test in the browser

Replace placeholders with your real values:

`https://YOUR_APP_ORIGIN/api/cron/marketing-email?secret=YOUR_MARKETING_CRON_SECRET`

You should see JSON including `"ok": true`. A `401` means the secret does not match what the server has.

---

## Local test

From the project root (with `.env.local` loaded or variables exported):

```bash
npm run cron:marketing-email
```
