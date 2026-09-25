-- Migration 259: proof of SMS consent, and the gated guide invite.
--
-- 1. sms_consent_records — an append-only record of every time a couple agreed
--    to texts: which venue, which lead, the number, and the EXACT wording they
--    saw (with its version), plus IP / user agent / page. `leads.sms_consent` is
--    the switch the send paths read; this table is the evidence behind it, kept
--    even if the lead is later deleted (lead_id is set null, the row stays).
--
-- 2. guide_invites — one row per lead that got the gated "Send me my guide"
--    email (directory leads captured by LeadFinder, which arrive without SMS
--    consent). Tracks the invite, the one reminder, when they tapped (the
--    opt-in), and the 48h fallback that sends the guide by email and starts the
--    sequence without SMS for couples who never tapped.
--
-- Safety: purely additive — two new tables, nothing existing is touched. The
-- application treats a missing table as "feature not available yet" and keeps
-- today's behaviour, so deploy order does not matter. Idempotent.

CREATE TABLE IF NOT EXISTS public.sms_consent_records (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  lead_id             uuid        REFERENCES public.leads(id) ON DELETE SET NULL,
  phone               text        NOT NULL,
  email               text,
  -- guide_invite (the gated guide page) | form_submit (a lead form)
  source              text        NOT NULL,
  -- Where exactly: 'directory', 'embed', 'lead_link', 'marketing_form', …
  source_detail       text,
  disclosure_version  text        NOT NULL,
  disclosure_text     text        NOT NULL,
  ip                  text,
  user_agent          text,
  page_url            text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sms_consent_records_lead_idx
  ON public.sms_consent_records (lead_id);
CREATE INDEX IF NOT EXISTS sms_consent_records_venue_idx
  ON public.sms_consent_records (venue_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.guide_invites (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  lead_id           uuid        NOT NULL UNIQUE REFERENCES public.leads(id) ON DELETE CASCADE,
  invite_sent_at    timestamptz NOT NULL DEFAULT now(),
  reminder_sent_at  timestamptz,
  -- They tapped "Send my guide": the SMS opt-in.
  tapped_at         timestamptz,
  -- No tap by 48h: guide sent by email and the sequence started without SMS.
  fallback_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- The cron's only query shape: invites still waiting on the couple.
CREATE INDEX IF NOT EXISTS guide_invites_pending_idx
  ON public.guide_invites (invite_sent_at)
  WHERE tapped_at IS NULL AND fallback_at IS NULL;
CREATE INDEX IF NOT EXISTS guide_invites_venue_idx
  ON public.guide_invites (venue_id);

-- Server-only tables: RLS on with no policies, so only the service role reads them.
ALTER TABLE public.sms_consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guide_invites ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
