#!/usr/bin/env node
/**
 * Manage the bearer keys AI agents use for the StoryVenue MCP server (/api/mcp).
 * One key per agent, so any agent can be switched off on its own.
 *
 *   node scripts/mcp-keys.mjs create <name>   # prints the key ONCE — store it in the agent's secrets
 *   node scripts/mcp-keys.mjs list            # names, prefixes, last used, revoked
 *   node scripts/mcp-keys.mjs revoke <name>   # stops working within a minute
 *   node scripts/mcp-keys.mjs usage [days]    # tool calls per agent (default 7 days)
 *
 * Only a SHA-256 hash of each key is stored (table mcp_api_keys, migration 260).
 * Reads SUPABASE_DB_URL from .env.local, like apply-all-migrations.mjs.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const envText = readFileSync(join(repoRoot, '.env.local'), 'utf8');
const dbUrl = (envText.match(/^SUPABASE_DB_URL\s*=\s*(.+)$/m) || [])[1]?.trim().replace(/^"|"$/g, '');
if (!dbUrl) {
  console.error('SUPABASE_DB_URL not found in .env.local');
  process.exit(1);
}

const [cmd, arg] = process.argv.slice(2);
const usage = 'Usage: node scripts/mcp-keys.mjs create <name> | list | revoke <name> | usage [days]';

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
try {
  if (cmd === 'create') {
    const name = (arg || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(name)) throw new Error('Name: 2-41 characters, letters, digits, - or _ (e.g. jarvis).');
    const key = `svmcp_${randomBytes(32).toString('base64url')}`;
    const hash = createHash('sha256').update(key).digest('hex');
    const { rowCount } = await client.query(
      `insert into public.mcp_api_keys (name, key_hash, key_prefix) values ($1, $2, $3)
       on conflict (name) do nothing`,
      [name, hash, key.slice(0, 12)],
    );
    if (!rowCount) throw new Error(`A key named "${name}" already exists. Revoke it or pick another name.`);
    console.log(`Key for "${name}" (shown once — store it now):\n\n${key}\n`);
  } else if (cmd === 'list') {
    const { rows } = await client.query(
      `select name, key_prefix, created_at, last_used_at, revoked_at from public.mcp_api_keys order by created_at`,
    );
    console.table(rows.map((r) => ({
      name: r.name,
      prefix: `${r.key_prefix}…`,
      created: r.created_at?.toISOString().slice(0, 16),
      last_used: r.last_used_at?.toISOString().slice(0, 16) ?? '—',
      status: r.revoked_at ? `revoked ${r.revoked_at.toISOString().slice(0, 10)}` : 'active',
    })));
  } else if (cmd === 'revoke') {
    const { rowCount } = await client.query(
      `update public.mcp_api_keys set revoked_at = now() where name = $1 and revoked_at is null`,
      [(arg || '').trim().toLowerCase()],
    );
    console.log(rowCount ? `Revoked "${arg}".` : `No active key named "${arg}".`);
  } else if (cmd === 'usage') {
    const days = Math.max(1, Math.min(365, Number(arg) || 7));
    const { rows } = await client.query(
      `select key_name as agent, tool, count(*)::int as calls, count(*) filter (where not ok)::int as errors,
              round(avg(duration_ms))::int as avg_ms, max(created_at) as last_call
         from public.mcp_audit_log where created_at > now() - make_interval(days => $1)
        group by 1, 2 order by 1, 3 desc`,
      [days],
    );
    console.table(rows.map((r) => ({ ...r, last_call: r.last_call?.toISOString().slice(0, 16) })));
  } else {
    console.log(usage);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
