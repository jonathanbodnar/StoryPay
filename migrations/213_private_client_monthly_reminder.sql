-- 213: Private Client monthly pipeline reminder tracking
--
-- Context: Private Client venues (is_private_client = true) get a monthly email
-- reminding the owner + team to log in and move contacts who booked a tour or
-- booked a wedding into the correct pipeline stage, so tours/bookings are tracked
-- accurately for their reporting and our monthly review calls. The reminder is
-- controlled entirely by the Private Client checkbox — unchecking it stops sends.
--
-- We drive the monthly cadence off an advancing timestamp (private_client_
-- monthly_reminder_next_at), exactly like the booking-report schedule: the cron
-- runs daily and only actually sends when next_at <= now(), then advances it to
-- the 1st of the following month. _last_sent_at is audit-only.
--
-- Seeding: existing Private Clients are set to the 1st of NEXT month so deploying
-- this does not blast everyone immediately — the first real send lands on the
-- next 1st. Newly-flagged private clients (null next_at) are seeded the same way
-- by the cron on first pass.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS private_client_monthly_reminder_next_at   timestamptz,
  ADD COLUMN IF NOT EXISTS private_client_monthly_reminder_last_sent_at timestamptz;

COMMENT ON COLUMN public.venues.private_client_monthly_reminder_next_at IS
  'Next scheduled send of the Private Client monthly pipeline reminder. Advanced to the 1st of the following month after each successful send. NULL = not yet seeded.';
COMMENT ON COLUMN public.venues.private_client_monthly_reminder_last_sent_at IS
  'Timestamp the Private Client monthly pipeline reminder was last sent (audit only).';

UPDATE public.venues
   SET private_client_monthly_reminder_next_at = date_trunc('month', now()) + interval '1 month'
 WHERE is_private_client = true
   AND private_client_monthly_reminder_next_at IS NULL;
