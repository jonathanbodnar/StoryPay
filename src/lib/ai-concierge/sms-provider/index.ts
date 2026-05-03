/**
 * SMS provider factory + convenience wrapper.
 *
 * Reads `venues.sms_provider` and returns the matching provider instance.
 * To add a new provider:
 *   1. Implement the `SmsProvider` interface in a sibling file
 *   2. Register it in `REGISTRY` below
 *   3. Set `venues.sms_provider = '<your-key>'` for the venues that should
 *      use it (per-venue routing — existing venues stay on their current
 *      provider until explicitly switched)
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { SmsProvider } from './types';
import { ghlSmsProvider } from './ghl-provider';

const REGISTRY: Record<string, SmsProvider> = {
  ghl: ghlSmsProvider,
};

const DEFAULT_PROVIDER_KEY = 'ghl';

/** Look up a provider by its registry key. Falls back to the default. */
export function getSmsProviderByKey(key: string | null | undefined): SmsProvider {
  if (key && REGISTRY[key]) return REGISTRY[key];
  return REGISTRY[DEFAULT_PROVIDER_KEY];
}

/** Resolve the SMS provider for a given venue based on its `sms_provider` column. */
export async function getSmsProviderForVenue(venueId: string): Promise<SmsProvider> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('sms_provider')
    .eq('id', venueId)
    .maybeSingle();
  const key = (data as { sms_provider?: string | null } | null)?.sms_provider ?? DEFAULT_PROVIDER_KEY;
  return getSmsProviderByKey(key);
}

/**
 * One-shot send through whichever provider is configured for this venue.
 * Used everywhere in the AI engine — never call providers directly.
 */
export async function sendAiSms(input: {
  venueId: string;
  leadId: string;
  message: string;
}) {
  const provider = await getSmsProviderForVenue(input.venueId);
  const result = await provider.send(input);
  // Tag the result with the provider key so callers can log which provider sent
  return { ...result, providerKey: provider.key };
}

/** All registered provider keys — useful for super-admin UI. */
export function listRegisteredSmsProviders(): Array<{ key: string; label: string }> {
  return Object.values(REGISTRY).map((p) => ({ key: p.key, label: p.label }));
}

export type {
  SmsProvider,
  SmsSendInput,
  SmsSendResult,
  SmsSendOutcome,
} from './types';
