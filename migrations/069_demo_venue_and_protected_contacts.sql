-- 069_demo_venue_and_protected_contacts.sql
-- Adds is_demo flag to venues so we can bypass duplicate rules / unlock
-- full testing for a designated demo account.
-- Adds is_protected flag to leads and venue_customers so a single
-- "anchor" contact can be prevented from accidental deletion.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS is_protected boolean NOT NULL DEFAULT false;

ALTER TABLE public.venue_customers
  ADD COLUMN IF NOT EXISTS is_protected boolean NOT NULL DEFAULT false;

-- Mark the storyvenue demo account
UPDATE public.venues SET is_demo = true WHERE slug = 'storyvenue';

-- Protect the primary Jason Westbrook lead (oldest one for this venue)
UPDATE public.leads
SET is_protected = true
WHERE venue_id  = (SELECT id FROM public.venues WHERE slug = 'storyvenue')
  AND email     = 'jason@themission.group'
  AND id = (
    SELECT id FROM public.leads
    WHERE venue_id = (SELECT id FROM public.venues WHERE slug = 'storyvenue')
      AND email    = 'jason@themission.group'
    ORDER BY created_at ASC
    LIMIT 1
  );

-- Protect the matching venue_customer record
UPDATE public.venue_customers
SET is_protected = true
WHERE venue_id       = (SELECT id FROM public.venues WHERE slug = 'storyvenue')
  AND customer_email ILIKE 'jason@themission.group';

NOTIFY pgrst, 'reload schema';
