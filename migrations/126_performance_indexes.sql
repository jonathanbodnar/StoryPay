-- 126: Performance indexes for hot query paths
--
-- These are purely additive — safe to run at any time with no downtime
-- risk. Postgres builds each index without locking reads/writes because
-- all statements use CREATE INDEX IF NOT EXISTS (no CONCURRENTLY needed
-- on tables that are not yet huge; add CONCURRENTLY if table > 1M rows).

-- proposals(venue_id, created_at) — eliminates full-table scan on
-- every dashboard stats load and proposals list fetch.
CREATE INDEX IF NOT EXISTS proposals_venue_id_created_at_idx
  ON public.proposals (venue_id, created_at DESC);

-- proposals(venue_id, status) — used by the stats route when filtering
-- by status (signed, paid, etc.) scoped to a venue.
CREATE INDEX IF NOT EXISTS proposals_venue_id_status_idx
  ON public.proposals (venue_id, status);

-- calendar_events composite — covers the booking-trends query that
-- filters (venue_id, event_type IN (...), start_at BETWEEN ...).
-- Partial index on status != 'cancelled' shrinks index size by excluding
-- noise rows that are never relevant to dashboard counts.
CREATE INDEX IF NOT EXISTS calendar_events_venue_type_start_idx
  ON public.calendar_events (venue_id, event_type, start_at DESC)
  WHERE status <> 'cancelled';

-- leads(venue_id, created_at) — the Kanban board fetches all open
-- leads for a venue ordered by creation time.
CREATE INDEX IF NOT EXISTS leads_venue_id_created_at_idx
  ON public.leads (venue_id, created_at DESC);

-- leads(venue_id, ai_state) — used by AI activation cron.
CREATE INDEX IF NOT EXISTS leads_venue_id_ai_state_idx
  ON public.leads (venue_id, ai_state);

-- conversation_threads(venue_id, status) — support inbox filters by
-- status on every inbox load.
CREATE INDEX IF NOT EXISTS conv_threads_venue_id_status_idx
  ON public.conversation_threads (venue_id, status);

-- marketing_automation_enrollments(lead_id, status) — the marketing
-- worker queries these on every cron tick.
CREATE INDEX IF NOT EXISTS mkt_enrollments_lead_status_idx
  ON public.marketing_automation_enrollments (lead_id, status);
