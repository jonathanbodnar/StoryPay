-- Migration 141: hide the "Booking System" plan from all public-facing UIs.
-- The plan still exists in the DB (venues currently on it keep their subscription)
-- but it is removed from the signup plan picker and the billing page plan list.
-- Upgrades to this tier will now happen via a sales/demo call only.

UPDATE public.directory_plans
   SET is_public = FALSE
 WHERE LOWER(TRIM(name)) LIKE '%booking%system%'
    OR LOWER(TRIM(slug)) LIKE '%booking%system%';
