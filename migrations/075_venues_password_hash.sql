-- Add password_hash column to venues for email+password auth
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS password_hash TEXT;
