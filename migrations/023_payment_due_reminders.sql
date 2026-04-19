-- Payment due email reminders (installment schedule) — mirrors appointment reminder pattern
-- Max 3 offsets per venue; queued rows per proposal installment × offset

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS payment_reminders_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS payment_reminder_offsets jsonb NOT NULL DEFAULT '[
    {"d":3,"h":0,"m":0},
    {"d":1,"h":0,"m":0},
    {"d":0,"h":2,"m":0}
  ]'::jsonb;

COMMENT ON COLUMN public.venues.payment_reminders_enabled IS 'When true, schedule customer emails before installment due dates (signed proposals with installment payment_config).';
COMMENT ON COLUMN public.venues.payment_reminder_offsets IS 'Array (max 3) of {d,h,m} = send this long before due instant (venue time zone).';

CREATE TABLE IF NOT EXISTS public.proposal_payment_reminders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id         uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  venue_id            uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  installment_index   integer NOT NULL,
  reminder_index      integer NOT NULL,
  offset_days         integer NOT NULL DEFAULT 0,
  offset_hours        integer NOT NULL DEFAULT 0,
  offset_minutes      integer NOT NULL DEFAULT 0,
  send_at             timestamptz NOT NULL,
  due_at              timestamptz NOT NULL,
  installment_amount_cents integer,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proposal_payment_reminders_reminder_idx_chk CHECK (reminder_index >= 0 AND reminder_index < 3),
  CONSTRAINT proposal_payment_reminders_offset_nonneg CHECK (
    offset_days >= 0 AND offset_hours >= 0 AND offset_minutes >= 0
  ),
  CONSTRAINT proposal_payment_reminders_unique UNIQUE (proposal_id, installment_index, reminder_index)
);

CREATE INDEX IF NOT EXISTS proposal_payment_reminders_due_idx
  ON public.proposal_payment_reminders (send_at)
  WHERE sent_at IS NULL;

CREATE INDEX IF NOT EXISTS proposal_payment_reminders_venue_id_idx ON public.proposal_payment_reminders (venue_id);

CREATE INDEX IF NOT EXISTS proposal_payment_reminders_proposal_id_idx ON public.proposal_payment_reminders (proposal_id);

NOTIFY pgrst, 'reload schema';
