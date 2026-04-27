-- Add owner first/last name directly to venues so the Profile page can
-- persist them without going through the profiles table (which has stricter
-- RLS and requires owner_id to be set).  Backfill from profiles.full_name.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS owner_first_name text,
  ADD COLUMN IF NOT EXISTS owner_last_name  text;

-- Back-fill from profiles where owner_id is set and the profile has a name
UPDATE public.venues v
SET
  owner_first_name = trim(split_part(p.full_name, ' ', 1)),
  owner_last_name  = trim(
    substring(p.full_name from char_length(split_part(p.full_name, ' ', 1)) + 2)
  )
FROM public.profiles p
WHERE v.owner_id = p.id
  AND p.full_name IS NOT NULL
  AND p.full_name <> ''
  AND v.owner_first_name IS NULL;
