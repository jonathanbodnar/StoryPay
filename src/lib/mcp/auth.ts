/**
 * Who is calling the MCP server.
 *
 * Every agent has its own long-lived bearer key (scripts/mcp-keys.mjs creates,
 * lists and revokes them); only a SHA-256 hash is stored, in mcp_api_keys.
 * The older single MCP_API_KEY env var still works and is reported as
 * "legacy". No key, a wrong key or a revoked key → no access (fails closed).
 */

import { createHash, timingSafeEqual } from 'crypto';
import { getDbAsync } from '@/lib/db';

export interface McpCaller {
  /** The key's name, e.g. "jarvis". */
  name: string;
  legacy: boolean;
}

export const LEGACY_KEY_NAME = 'legacy (MCP_API_KEY)';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a));
  const y = Buffer.from(sha256(b));
  return timingSafeEqual(x, y);
}

// A revoked key stops working within a minute.
const CACHE_MS = 60_000;
const cache = new Map<string, { caller: McpCaller | null; at: number }>();

export async function authenticateMcp(authorization: string | null): Promise<McpCaller | null> {
  const token = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const legacy = process.env.MCP_API_KEY?.trim();
  if (legacy && sameSecret(token, legacy)) return { name: LEGACY_KEY_NAME, legacy: true };

  const hash = sha256(token);
  const hit = cache.get(hash);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.caller;

  let caller: McpCaller | null = null;
  try {
    const sql = await getDbAsync();
    const rows = await sql.unsafe(
      `update public.mcp_api_keys
          set last_used_at = now()
        where key_hash = $1 and revoked_at is null
        returning name`,
      [hash],
    );
    const name = (rows[0] as { name?: string } | undefined)?.name;
    caller = name ? { name, legacy: false } : null;
  } catch (err) {
    console.error('[mcp] key lookup failed:', err instanceof Error ? err.message : err);
    return null; // don't cache a lookup failure
  }
  cache.set(hash, { caller, at: Date.now() });
  return caller;
}

/** One row per tool call — who, what, how long, ok or not. Never the result. */
export function auditMcpCall(entry: {
  keyName: string;
  tool: string;
  args: unknown;
  ok: boolean;
  error?: string | null;
  durationMs: number;
  resultBytes?: number;
}): void {
  void (async () => {
    const argsJson = JSON.stringify(entry.args ?? {});
    const sql = await getDbAsync();
    await sql.unsafe(
      `insert into public.mcp_audit_log (key_name, tool, args, ok, error, duration_ms, result_bytes)
       values ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
      [
        entry.keyName,
        entry.tool,
        argsJson.length > 4000 ? JSON.stringify({ truncated: argsJson.slice(0, 4000) }) : argsJson,
        entry.ok,
        entry.error ? entry.error.slice(0, 1000) : null,
        entry.durationMs,
        entry.resultBytes ?? null,
      ],
    );
  })().catch((err) => console.warn('[mcp] audit write failed:', err instanceof Error ? err.message : err));
}
