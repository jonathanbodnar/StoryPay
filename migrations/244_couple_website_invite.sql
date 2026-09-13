-- 244_couple_website_invite.sql
--
-- Additive, expand-only migration for the couple-side "Invite guests to your
-- wedding website" feature. Two brand-new tables — nothing on older deploys
-- reads or writes them, so there is zero risk to existing data. Both are
-- idempotent (IF NOT EXISTS) and the file ends with a PostgREST schema reload
-- so the API sees them immediately.
--
--  1. couple_email_suppressions — per-couple email opt-outs. When a guest clicks
--     the one-click / List-Unsubscribe link in a website invite, we record the
--     suppression here (scoped to that couple's wedding) so they are excluded
--     from all future couple sends. Mirrors marketing_email_suppressions.
--
--  2. couple_website_invite_sends — a small send log so the UI can show
--     "last sent" and guard against accidental double-blasts.

CREATE TABLE IF NOT EXISTS public.couple_email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The wedding whose guest list this suppression applies to. Cascade: if the
  -- underlying couple_weddings link is deleted, its suppressions go with it.
  couple_wedding_id uuid NOT NULL REFERENCES public.couple_weddings(id) ON DELETE CASCADE,
  -- Stored lowercased + trimmed by the app layer.
  email text NOT NULL,
  -- 'unsubscribe' (link click) or 'one_click_unsubscribe' (RFC 8058 POST).
  reason text NOT NULL DEFAULT 'unsubscribe',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One suppression row per (wedding, email); repeat clicks upsert harmlessly.
CREATE UNIQUE INDEX IF NOT EXISTS couple_email_suppressions_wedding_email_idx
  ON public.couple_email_suppressions (couple_wedding_id, lower(email));

CREATE TABLE IF NOT EXISTS public.couple_website_invite_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_wedding_id uuid NOT NULL REFERENCES public.couple_weddings(id) ON DELETE CASCADE,
  -- The auth.users id of the owner who triggered the send.
  sent_by uuid,
  subject text,
  recipient_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS couple_website_invite_sends_wedding_idx
  ON public.couple_website_invite_sends (couple_wedding_id, created_at DESC);

-- Let PostgREST / the API pick up the new tables right away.
NOTIFY pgrst, 'reload schema';
