-- Per-venue add-ons that ride alongside the directory subscription.
-- Each flag drives a fixed monthly surcharge on top of the plan price,
-- recalculated and pushed to LunarPay whenever it toggles. Top-tier plans
-- mark these as "included" via feature_flags so toggling has no effect on
-- the bill (charge stays at the plan price). Statuses
-- (directory_verified_status / directory_sponsored_status) remain the
-- admin-approval flow and are unchanged here.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS directory_addon_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS directory_addon_sponsored BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.venues.directory_addon_verified IS
  'Owner has subscribed to the Verified Listing add-on ($19/mo). Has no billing effect when the current plan includes verified for free.';
COMMENT ON COLUMN public.venues.directory_addon_sponsored IS
  'Owner has subscribed to the Sponsored Listing add-on ($99/mo). Has no billing effect when the current plan includes sponsored for free.';

-- Plan-level inclusion flags. When TRUE, the addon is bundled with the plan
-- price at no extra charge and the checkbox renders as "Included" + locked.
-- Stored inside feature_flags JSONB to avoid touching the table shape.
-- Defaults are intentionally NOT set here — super admin sets them per plan
-- in the directory plans editor. The frontend treats absence as `false`.

NOTIFY pgrst, 'reload schema';
