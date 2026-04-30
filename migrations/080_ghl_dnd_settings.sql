-- ─────────────────────────────────────────────────────────────────────────────
-- 080 · GHL per-channel DND settings on venue_customers
-- ─────────────────────────────────────────────────────────────────────────────
-- Stores the full GHL dndSettings object (per-channel: Call, Email, SMS, WhatsApp, GMB, FB)
-- and inboundDndSettings (all) synced from GHL contacts API.
--
-- Shape:
--   ghl_dnd_settings: { "Call": {"status":"active"|"inactive"}, "Email": {...}, "SMS": {...}, ... }
--   ghl_inbound_dnd_settings: { "all": {"status":"active"|"inactive"} }
--
-- "active" = DND is ON for that channel (contact opted out / blocked)
-- "inactive" = DND is OFF (contact can receive messages)

ALTER TABLE public.venue_customers
  ADD COLUMN IF NOT EXISTS ghl_dnd_settings jsonb,
  ADD COLUMN IF NOT EXISTS ghl_inbound_dnd_settings jsonb;

NOTIFY pgrst, 'reload schema';
