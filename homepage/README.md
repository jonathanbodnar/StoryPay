# StoryPay Homepage (storypay.io)

Standalone Next.js 16 app that serves the public marketing site at **storypay.io**:

- `/` — countdown landing page with waitlist modal
- `/privacy` — privacy policy
- `/terms` — terms of use
- `/api/waitlist` — waitlist form backend (writes to Supabase, notifies via Resend)
- `/robots.txt`, `/sitemap.xml`

The venue-owner dashboard lives in the main StoryPay app at **app.storyvenue.com** — this
homepage app does not import any dashboard code and does not need access to any tables
except `waitlist` and (optionally) `page_seo`.

---

## Local development

```bash
cd homepage
cp .env.example .env.local   # fill in Supabase + Resend creds
npm install
npm run dev
```

Visit <http://localhost:3000>.

## Deploy on Railway

1. Create a new Railway service pointing at the `StoryPay` repo.
2. Under **Settings → Source**, set **Root Directory** to `homepage`.
   Railway will run `npm install` and `npm run build` inside `homepage/` and ignore
   the rest of the monorepo.
3. Add the environment variables listed in `.env.example`.
4. Under **Settings → Networking**, attach the `storypay.io` custom domain.
5. Redeploy.

## Environment variables

| Name | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | yes | Public URL of this site, e.g. `https://storypay.io`. Used for canonical / OG / sitemap. |
| `NEXT_PUBLIC_DASHBOARD_URL` | yes | Where the "Log In" button and admin link point. e.g. `https://app.storyvenue.com`. |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Shared StoryPay Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon key. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase service role key (server-only, never exposed). |
| `RESEND_API_KEY` | no | Enables the "new waitlist signup" notification email. |
| `GOOGLE_SITE_VERIFICATION` | no | Google Search Console verification token. |

## Relationship to the main StoryPay app

The main app at `app.storyvenue.com` (repo root, outside this folder) used to also
serve this marketing page at `/`. After you confirm this standalone deploy is
healthy you can delete these now-duplicate files from the main app without
breaking anything, because `src/proxy.ts` in the main app already redirects
`app.storyvenue.com/` to `/login`:

- `src/app/page.tsx`
- `src/app/privacy/page.tsx`
- `src/app/terms/page.tsx`
- `src/app/robots.ts`
- `src/app/sitemap.ts`
- `src/app/api/waitlist/route.ts`
- `src/lib/page-seo.ts`

Until you delete them, both deploys will work — the main app's copies just won't
be reachable from the `app.storyvenue.com` host because of the proxy redirect.
