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
  /**
   * Platform-wide default daily SMS send cap per venue. Each venue can
   * override via `venues.ai_daily_send_cap`. NULL on a venue = use this.
   * Migration 100 sets the column default to 100.
   */
  defaultDailySendCap: number;
  /**
   * Cron heartbeats — stamped at the END of every successful cron tick.
   * The super-admin dashboard reads these to surface a green/amber/red
   * health badge. NULL means "never run yet" (or migration 102 not applied).
   */
  lastActivationCronAt: string | null;
  lastSendCronAt:       string | null;
  updatedAt:         string;
}

const CACHE_TTL_MS = 30_000;

interface CacheEntry { value: AiRuntimeSettings; loadedAt: number }
let cache: CacheEntry | null = null;

/** Hard-fallback returned when the table doesn't exist yet (pre-migration). */
const SAFE_DEFAULT: AiRuntimeSettings = {
  killSwitchEnabled:    false,
  killSwitchReason:     null,
  killSwitchSetBy:      null,
  killSwitchSetAt:      null,
  defaultDailySendCap:  100,
  lastActivationCronAt: null,
  lastSendCronAt:       null,
  updatedAt:            new Date(0).toISOString(),
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
    .select('kill_switch_enabled, kill_switch_reason, kill_switch_set_by, kill_switch_set_at, default_daily_send_cap, last_activation_cron_at, last_send_cron_at, updated_at')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    // 42P01 = table missing. 42703 = column missing (migration 100 not yet
    // applied — we still want kill-switch reads to work). Anything else gets
    // logged but we still return the safe default — same rationale as the AI
    // helpers' "never throw" discipline. We do NOT cache the failure: if the
    // table/column arrives we'll pick it up on the next call.
    if (error.code !== '42P01' && error.code !== '42703') {
      console.error('[ai-concierge] getAiRuntimeSettings error:', error.message);
    }
    if (error.code === '42703') {
      // Column missing → re-query without it so the kill switch still works.
      return await getAiRuntimeSettingsWithoutCap();
    }
    return SAFE_DEFAULT;
  }
  if (!data) {
    // Row missing somehow (truncated table?) — treat like "not configured"
    return SAFE_DEFAULT;
  }

  const rawCap = (data as { default_daily_send_cap?: number | null }).default_daily_send_cap;
  const heartbeats = data as {
    last_activation_cron_at?: string | null;
    last_send_cron_at?:       string | null;
  };
  const value: AiRuntimeSettings = {
    killSwitchEnabled:    data.kill_switch_enabled === true,
    killSwitchReason:     data.kill_switch_reason ?? null,
    killSwitchSetBy:      data.kill_switch_set_by ?? null,
    killSwitchSetAt:      data.kill_switch_set_at ?? null,
    defaultDailySendCap:  typeof rawCap === 'number' && rawCap > 0 ? rawCap : SAFE_DEFAULT.defaultDailySendCap,
    lastActivationCronAt: heartbeats.last_activation_cron_at ?? null,
    lastSendCronAt:       heartbeats.last_send_cron_at ?? null,
    updatedAt:            data.updated_at ?? new Date().toISOString(),
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

/**
 * Update the platform-wide default daily SMS send cap. Returns fresh settings.
 * Bypasses cache. Caller is responsible for validating positive integer.
 */
export async function setDefaultDailySendCap(input: {
  cap:  number;
}): Promise<AiRuntimeSettings> {
  if (!Number.isFinite(input.cap) || input.cap < 1 || input.cap > 100_000) {
    throw new Error('default_daily_send_cap must be an integer between 1 and 100000');
  }
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('ai_runtime_settings')
    .upsert({
      id:                     1,
      default_daily_send_cap: Math.floor(input.cap),
      updated_at:             now,
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

/**
 * Stamp a cron-heartbeat column at end of a successful cron tick.
 *
 * Best-effort: if migration 102 hasn't been applied yet (column missing),
 * this swallows the error so the cron itself doesn't fail. The dashboard
 * will simply show "no heartbeat yet" for that cron until the migration
 * runs.
 *
 * Bypasses the cache for the next read so the admin dashboard sees the
 * fresh timestamp immediately.
 */
export async function stampCronHeartbeat(
  which: 'activation' | 'send',
): Promise<void> {
  const col = which === 'activation' ? 'last_activation_cron_at' : 'last_send_cron_at';
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('ai_runtime_settings')
    .upsert({
      id:          1,
      [col]:       now,
      updated_at:  now,
    });
  if (error) {
    if (error.code !== '42703' && error.code !== '42P01') {
      console.error(`[ai-concierge] stampCronHeartbeat(${which}) failed:`, error.message);
    }
    return;
  }
  clearRuntimeSettingsCache();
}

/**
 * Pre-migration-100 fallback: re-read the row without the new column so
 * the kill-switch keeps working until migration 100 is applied. Internal.
 */
async function getAiRuntimeSettingsWithoutCap(): Promise<AiRuntimeSettings> {
  const { data, error } = await supabaseAdmin
    .from('ai_runtime_settings')
    .select('kill_switch_enabled, kill_switch_reason, kill_switch_set_by, kill_switch_set_at, updated_at')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) return SAFE_DEFAULT;

  return {
    killSwitchEnabled:    data.kill_switch_enabled === true,
    killSwitchReason:     data.kill_switch_reason ?? null,
    killSwitchSetBy:      data.kill_switch_set_by ?? null,
    killSwitchSetAt:      data.kill_switch_set_at ?? null,
    defaultDailySendCap:  SAFE_DEFAULT.defaultDailySendCap,
    lastActivationCronAt: null,
    lastSendCronAt:       null,
    updatedAt:            data.updated_at ?? new Date().toISOString(),
  };
}
