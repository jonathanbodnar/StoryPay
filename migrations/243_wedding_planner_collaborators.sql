-- 243_wedding_planner_collaborators.sql
--
-- Additive, expand-only migration: introduce Wedding Planner collaborators.
--
-- A couple (bride/owner) can invite up to 5 people into her Wedding Planner
-- backend, and a venue can assign at most 1 wedding coordinator per couple.
-- Each collaborator gets their own couple auth account and is granted
-- 'view' or 'edit' access to every Wedding Planner tool EXCEPT Budget, which
-- stays private to the owning couple.
--
-- This is a brand-new table — nothing reads/writes it yet on old deploys, so
-- there is zero risk to existing data. Idempotent (IF NOT EXISTS) and ends
-- with a PostgREST schema reload so the API sees the new table immediately.

CREATE TABLE IF NOT EXISTS public.wedding_planner_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The wedding this person collaborates on. Cascade: if the underlying
  -- couple_weddings link is deleted, its collaborators go with it (they cannot
  -- exist without the wedding).
  couple_wedding_id uuid NOT NULL REFERENCES public.couple_weddings(id) ON DELETE CASCADE,
  -- Who created the invite: 'couple' (one of the bride's up-to-5) or 'venue'
  -- (the assigned wedding coordinator).
  invited_by text NOT NULL DEFAULT 'couple',
  -- Optional semantic role. NULL for a normal couple invite; 'coordinator' for
  -- the venue-assigned coordinator.
  role text,
  name text,
  -- Stored lowercased by the app layer.
  email text,
  phone text,
  -- 'view' (read-only) or 'edit' (can change planning tools, never Budget).
  access_level text NOT NULL DEFAULT 'view',
  -- 'invited' (email sent, not yet accepted), 'active' (accepted + bound to an
  -- auth user), or 'revoked' (soft-deleted by the owner or venue).
  status text NOT NULL DEFAULT 'invited',
  -- Secret token embedded in the accept-invite email link.
  invite_token text,
  -- The collaborator's own auth.users id, set once they accept + sign up/link.
  collaborator_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS wedding_planner_collaborators_wedding_idx
  ON public.wedding_planner_collaborators (couple_wedding_id);

CREATE INDEX IF NOT EXISTS wedding_planner_collaborators_user_idx
  ON public.wedding_planner_collaborators (collaborator_user_id);

CREATE INDEX IF NOT EXISTS wedding_planner_collaborators_token_idx
  ON public.wedding_planner_collaborators (invite_token);

-- Let PostgREST / the API pick up the new table right away.
NOTIFY pgrst, 'reload schema';
