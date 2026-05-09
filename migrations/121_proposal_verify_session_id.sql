-- 121: add proposals.verify_session_id concurrency guard
--
-- The /api/proposals/public/[token]/verify-payment route is called once
-- by the LunarPay success page and (potentially) again by the LunarPay
-- webhook for the same checkout session. Both code paths run heavy
-- side-effects: createPaymentSchedule, createSubscription, send receipt
-- email, dispatch integration events, fire system tags, etc.
--
-- Without a guard, a fast double-click or a webhook race produces:
--   - Two payment schedules
--   - Two subscriptions
--   - Two receipt emails
--   - Duplicate notify-owner sends
--   - Duplicate integration events / Zapier triggers
--
-- The verify_session_id column is set atomically by the verify-payment
-- route on first call. Subsequent concurrent calls fail the WHERE clause
-- and return early with `already_paid: true`. The session id is also a
-- useful audit trail (you can see which LP session settled the proposal).

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS verify_session_id text;

CREATE INDEX IF NOT EXISTS proposals_verify_session_id_idx
  ON public.proposals (verify_session_id)
  WHERE verify_session_id IS NOT NULL;
