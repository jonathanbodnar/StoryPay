-- Backfill venues.onboarding_status to use the canonical LunarPay status set,
-- and widen the CHECK constraint to accept the new values.
--
-- Background: the column historically overloaded the literal string 'pending'
-- to mean two different states, which made it impossible to tell from the
-- admin UI whether a venue had actually started a LunarPay application:
--
--   • 38 venues had onboarding_status='pending' with NO lunarpay_merchant_id
--     (admin created the venue row but merchant provisioning was skipped or
--     failed silently). These venues never started an application.
--
--   • 19 venues had onboarding_status='pending' WITH a lunarpay_merchant_id
--     (merchant was provisioned at LunarPay but the owner never submitted
--     Step 2 / the Fortis MPA). These venues registered but didn't apply.
--
-- After this migration the column only ever holds one of:
--   not_started | registered | bank_information_sent | under_review | active | denied
-- (see src/lib/lunarpay-status.ts). 'pending' is kept in the CHECK constraint
-- purely for backward compatibility with any in-flight rows; the application
-- layer will never write it again.

BEGIN;

-- 1) Widen the CHECK constraint to accept the new canonical values.
--    Drop the old constraint first, then add a new one with the full set.
ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_onboarding_status_check;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_onboarding_status_check
  CHECK (onboarding_status = ANY (ARRAY[
    'not_started'::text,
    'registered'::text,
    'bank_information_sent'::text,
    'under_review'::text,
    'active'::text,
    'denied'::text,
    -- legacy values still allowed so old rows / concurrent writes don't trip
    -- the constraint during the transition window
    'pending'::text
  ]));

-- 1b) Change the column default so new venue rows (e.g. self-serve signup,
--     which doesn't explicitly set onboarding_status) land on 'not_started'
--     instead of the ambiguous legacy 'pending'.
ALTER TABLE public.venues
  ALTER COLUMN onboarding_status SET DEFAULT 'not_started'::text;

-- 2) Venues that have no LunarPay merchant on file but were sitting at
--    'pending' → they never started. Move them to 'not_started'.
UPDATE public.venues
   SET onboarding_status = 'not_started'
 WHERE onboarding_status = 'pending'
   AND lunarpay_merchant_id IS NULL;

-- 3) Venues that HAVE a LunarPay merchant (so registration succeeded) but
--    were sitting at 'pending' → they registered but didn't submit the MPA.
--    Move them to 'registered' so the wizard resumes at the banking step.
UPDATE public.venues
   SET onboarding_status = 'registered'
 WHERE onboarding_status = 'pending'
   AND lunarpay_merchant_id IS NOT NULL;

COMMIT;
