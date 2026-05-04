/**
 * AI Concierge — global runtime settings (kill switch).
 *
 * Singleton row in `ai_runtime_settings`. Both crons consult this before
 * doing any work; super admin flips it from /admin/ai-concierge.
 *
 * Reads are cached for 30 seconds so the high-frequency send-cron (every
 * 10 min, but each cron tick can make many lead-level decisions) doesn't
 * round-trip the DB on every check. The cache TTL is short enough that
 * "I just hit the kill switch" is honored within ~30 seconds, which is
 * the right trade-off for a stop-the-world lever (you can't stop work
 * already in flight, but the next batch picks it up).
 *
 * `clearRuntimeSettingsCache()` is exposed so the admin PATCH endpoint
 * can force-invalidate after a write (gives the toggle "instant" feel).
 */

import { supabaseAdmin } from '@/lib/supabase';

export interface AiRuntimeSettings {
  killSwitchEnabled: boolean;
  killSwitchReason:  string | null;
  killSwitchSetBy:   string | null;
  killSwitchSetAt:   string | null;
  updatedAt:         string;
}

const CACHE_TTL_MS = 30_000;

interface CacheEntry { value: AiRuntimeSettings; loadedAt: number }
let cache: CacheEntry | null = null;

/** Hard-fallback returned when the table doesn't exist yet (pre-migration). */
const SAFE_DEFAULT: AiRuntimeSettings = {
  killSwitchEnabled: false,
  killSwitchReason:  null,
  killSwitchSetBy:   null,
  killSwitchSetAt:   null,
  updatedAt:         new Date(0).toISOString(),
};

/**
 * Read the runtime settings, with a 30-second in-memory cache.
 * Returns the SAFE_DEFAULT (kill switch off) if the table is missing,
 * so a never-applied migration doesn't accidentally halt the AI engine.
 */
export async function getAiRuntimeSettings(force = false): Promise<AiRuntimeSettings> {
  if (!force && cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.value;
  }

  const { data, error } = await supabaseAdmin
    .from('ai_runtime_settings')
    .select('kill_switch_enabled, kill_switch_reason, kill_switch_set_by, kill_switch_set_at, updated_at')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    // 42P01 = table missing. Anything else gets logged but we still return
    // the safe default — same rationale as the AI helpers' "never throw"
    // discipline. We do NOT cache the failure: if the table arrives we'll
    // pick it up on the next call.
    if (error.code !== '42P01') {
      console.error('[ai-concierge] getAiRuntimeSettings error:', error.message);
    }
    return SAFE_DEFAULT;
  }
  if (!data) {
    // Row missing somehow (truncated table?) — treat like "not configured"
    return SAFE_DEFAULT;
  }

  const value: AiRuntimeSettings = {
    killSwitchEnabled: data.kill_switch_enabled === true,
    killSwitchReason:  data.kill_switch_reason ?? null,
    killSwitchSetBy:   data.kill_switch_set_by ?? null,
    killSwitchSetAt:   data.kill_switch_set_at ?? null,
    updatedAt:         data.updated_at ?? new Date().toISOString(),
  };
  cache = { value, loadedAt: Date.now() };
  return value;
}

/**
 * Convenience: returns true if the kill switch is currently engaged.
 */
export async function isAiKillSwitchOn(): Promise<boolean> {
  const s = await getAiRuntimeSettings();
  return s.killSwitchEnabled;
}

/**
 * Update the kill switch. Returns the fresh settings.
 * Bypasses cache to make sure the writer reads back the value they wrote.
 */
export async function setAiKillSwitch(input: {
  enabled: boolean;
  reason?:  string | null;
  setBy?:   string | null;
}): Promise<AiRuntimeSettings> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('ai_runtime_settings')
    .upsert({
      id:                  1,
      kill_switch_enabled: input.enabled,
      kill_switch_reason:  input.enabled ? (input.reason ?? null) : null,
      kill_switch_set_by:  input.enabled ? (input.setBy  ?? null) : null,
      kill_switch_set_at:  input.enabled ? now : null,
      updated_at:          now,
    });

  if (error) {
    throw new Error(`Failed to update ai_runtime_settings: ${error.message}`);
  }

  clearRuntimeSettingsCache();
  return await getAiRuntimeSettings(true);
}

/** Force the cache to refresh on the next call. */
export function clearRuntimeSettingsCache(): void {
  cache = null;
}
