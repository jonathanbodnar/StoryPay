-- Run this in Supabase → SQL Editor → New query → Run (one click after paste).
-- Use after creating new tables if the app shows: "could not find ... in the schema cache"

NOTIFY pgrst, 'reload schema';
