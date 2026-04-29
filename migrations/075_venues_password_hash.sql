-- Add password_hash column to venues for email+password auth
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Force PostgREST to refresh its schema cache so the new column is
-- visible to the REST API immediately (otherwise inserts from the app
-- fail with "Could not find the 'password_hash' column" until the
-- next automatic refresh).
NOTIFY pgrst, 'reload schema';
