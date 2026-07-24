-- Migration 179: A2P mirrors the GHL sub-account
--
-- A2P carrier registration lives on each venue's GHL messaging sub-account,
-- so a connected sub-account means A2P is verified and active. The app now
-- stamps a2p_verified on every connect/disconnect path (settings save, OAuth
-- callback, AppInstall/AppUninstall webhooks); this backfills venues that
-- connected before that stamping existed.

UPDATE public.venues
   SET a2p_verified = TRUE
 WHERE a2p_verified IS DISTINCT FROM TRUE
   AND (ghl_connected = TRUE OR ghl_location_id IS NOT NULL);
