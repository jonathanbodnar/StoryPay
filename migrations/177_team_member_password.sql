-- Migration 177: Team member password hashes
--
-- Team members currently use their invite_token as a plaintext "password".
-- This adds a proper bcrypt-hashed password column so members can change
-- their own password from the My Profile page.
--
-- Sign-in falls back to the invite_token for members who haven't set a
-- password yet (backwards-compatible).

ALTER TABLE public.venue_team_members
  ADD COLUMN IF NOT EXISTS password_hash text;
