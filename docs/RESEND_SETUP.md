# Resend (SaaS-wide email)

StoryPay uses **Resend** for all app-delivered email: auth, proposals, invoices, marketing worker, team invites, conversations, Ask AI escalation, etc.

## 1. Account and API key

1. Create a project at [resend.com](https://resend.com).
2. Create an API key with **Sending** (and **Receiving** if you use conversation replies).
3. Set on your host (Vercel, etc.):

```bash
RESEND_API_KEY=re_xxxxxxxx
```

## 2. Sending domain (required for production)

1. In Resend → **Domains**, add your domain (e.g. `storyvenue.com`).
2. Add the DNS records Resend shows (SPF, DKIM, etc.) until status is verified.
3. Set the default **From** for the app (must use that domain):

```bash
RESEND_DEFAULT_FROM="StoryVenue <noreply@storyvenue.com>"
```

Use the exact From you verified in Resend (bare `noreply@storyvenue.com` is fine). If unset locally, the code falls back to `StoryVenue <noreply@storyvenue.com>`.

Per-email `from` overrides still apply (e.g. venue **brand email** in Settings → **Branding**) — those addresses must be verified in Resend. If brand email is empty, the **display name** is still your venue name and the **address** comes from `RESEND_DEFAULT_FROM`.

**Still seeing `StoryPay <noreply@storypay.io>` after setting `RESEND_DEFAULT_FROM`?**

- Add the variable on **Production** in your host (Vercel: Settings → Environment Variables → Production, not only Preview).
- **Redeploy** after saving env vars.
- Check **Settings → Branding** — if “brand email” is `noreply@storypay.io`, outbound conversation mail will use that address until you change it.

## 3. Conversations — inbound replies (optional)

So contact replies appear in **Dashboard → Conversations**:

1. Run migration `046_conversation_inbound_smtp_message_id.sql` (adds `smtp_message_id`).
2. In Resend → **Receiving**, add a subdomain (e.g. `inbound.yourdomain.com`) and configure **MX** as documented by Resend.
3. Set:

```bash
CONVERSATIONS_INBOUND_DOMAIN=inbound.yourdomain.com
CONVERSATIONS_INBOUND_SECRET=<long-random-secret>
```

4. Create a **Webhook** in Resend for event **`email.received`** pointing to:

`https://YOUR_APP_URL/api/webhooks/inbound-email?token=OPTIONAL_SECRET`

If you set `INBOUND_EMAIL_WEBHOOK_TOKEN`, use the same value as `token` in the URL.

5. Outbound conversation emails automatically use `Reply-To: reply+{threadId}+{signature}@CONVERSATIONS_INBOUND_DOMAIN` when the secret and domain are set; otherwise they fall back to the venue **brand email** (replies won’t ingest into StoryPay).

## 4. Webhook verification (recommended)

Resend signs webhooks (Svix). Optionally add `RESEND_WEBHOOK_SECRET` and verify signatures in `inbound-email` later; many teams rely on a long random `INBOUND_EMAIL_WEBHOOK_TOKEN` in the URL instead.

## 5. Checklist

- [ ] `RESEND_API_KEY` set
- [ ] Domain verified; `RESEND_DEFAULT_FROM` matches verified domain
- [ ] Test: Settings → Email templates → send test
- [ ] Conversations: receiving domain + webhook + `CONVERSATIONS_*` env if you need inbound threads

## 6. Removed providers

**SendGrid** is no longer used by this codebase. Remove `SENDGRID_API_KEY` from environment variables to avoid confusion.
