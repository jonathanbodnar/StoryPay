-- LunarPay merchant API keys + onboarding fields
-- Added when StoryPay Agency API integration was implemented.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS lunarpay_org_token   text,
  ADD COLUMN IF NOT EXISTS lunarpay_sk           text,
  ADD COLUMN IF NOT EXISTS lunarpay_pk           text,
  ADD COLUMN IF NOT EXISTS lunarpay_onboard_data jsonb; -- stores the submitted onboarding form so we can retry

COMMENT ON COLUMN public.venues.lunarpay_org_token   IS 'LunarPay org token returned on merchant registration (used for MPA embed URL).';
COMMENT ON COLUMN public.venues.lunarpay_sk           IS 'LunarPay merchant secret key (lp_sk_...). Set once merchant is ACTIVE.';
COMMENT ON COLUMN public.venues.lunarpay_pk           IS 'LunarPay merchant publishable key (lp_pk_...). Set once merchant is ACTIVE.';
COMMENT ON COLUMN public.venues.lunarpay_onboard_data IS 'Last submitted onboarding payload for reference / re-submission.';
