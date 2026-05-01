/**
 * API key utilities for the public StoryVenue integrations API.
 *
 * Tokens are formatted: sv_live_<32-char base32>
 *   - prefix `sv_live_` is human-recognisable and indexes-friendly
 *   - body is 160 bits of entropy (32 chars of crockford-style base32)
 *
 * We store ONLY the SHA-256 hash + the first 12 visible chars in the DB.
 * The plaintext is shown to the user exactly once at creation.
 */

import { createHash, randomBytes } from 'crypto';
import { supabaseAdmin } from './supabase';

const TOKEN_PREFIX = 'sv_live_';
const TOKEN_BODY_LEN = 32;

/** Base32 (Crockford) — no I/L/O/U to avoid confusion. */
const B32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomBase32(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += B32_ALPHABET[bytes[i] % B32_ALPHABET.length];
  }
  return out;
}

/** Generate a fresh `sv_live_*` plaintext token. Never persisted. */
export function generateApiKey(): string {
  return `${TOKEN_PREFIX}${randomBase32(TOKEN_BODY_LEN)}`;
}

/** SHA-256 of the plaintext token. This is what we store. */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/** First 12 chars of the plaintext, used for visual identification in the UI. */
export function apiKeyPrefix(plaintext: string): string {
  return plaintext.slice(0, 12);
}

export interface ApiKeyRow {
  id: string;
  venue_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  source: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface CreateApiKeyResult {
  /** The full plaintext key — return this to the caller exactly once. */
  plaintext: string;
  row: ApiKeyRow;
}

/** Create + persist a new API key for a venue. Returns the plaintext + row. */
export async function createApiKey(
  venueId: string,
  opts: { name?: string; source?: string; scopes?: string[] } = {},
): Promise<CreateApiKeyResult> {
  const plaintext = generateApiKey();
  const key_hash = hashApiKey(plaintext);
  const key_prefix = apiKeyPrefix(plaintext);

  const { data, error } = await supabaseAdmin
    .from('venue_api_keys')
    .insert({
      venue_id: venueId,
      name: opts.name?.trim() || 'API key',
      key_prefix,
      key_hash,
      source: opts.source || 'manual',
      scopes: opts.scopes || ['read', 'write'],
    })
    .select('*')
    .single();

  if (error) throw error;
  return { plaintext, row: data as ApiKeyRow };
}

/** List the venue's keys. Plaintext is never returned. */
export async function listApiKeys(venueId: string): Promise<ApiKeyRow[]> {
  const { data, error } = await supabaseAdmin
    .from('venue_api_keys')
    .select('*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as ApiKeyRow[];
}

/** Revoke (soft-delete) a key. Future requests with it will 401. */
export async function revokeApiKey(venueId: string, id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('venue_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('venue_id', venueId)
    .eq('id', id);
  if (error) throw error;
}

/**
 * Validate an incoming Bearer token.
 * Returns the matching active key row, or null if invalid/revoked.
 * Updates `last_used_at` (best effort).
 */
export async function validateApiKey(plaintext: string): Promise<ApiKeyRow | null> {
  if (!plaintext || !plaintext.startsWith(TOKEN_PREFIX)) return null;
  const key_hash = hashApiKey(plaintext);

  const { data } = await supabaseAdmin
    .from('venue_api_keys')
    .select('*')
    .eq('key_hash', key_hash)
    .is('revoked_at', null)
    .maybeSingle();

  if (!data) return null;

  // Best-effort last_used update — don't await
  void supabaseAdmin
    .from('venue_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', (data as ApiKeyRow).id)
    .then(() => {});

  return data as ApiKeyRow;
}
