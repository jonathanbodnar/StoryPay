/**
 * Database access for the AI-agent MCP server (/api/mcp).
 *
 * Two entry points, both READ ONLY transactions with a statement timeout:
 *
 *   readQuery()   — the server's own fixed SQL (the built-in tools). Runs as the
 *                   app's connection user; the SQL is ours, never the agent's.
 *   runAgentSql() — the free-form `run_sql` tool. The agent's SELECT runs as the
 *                   `mcp_readonly` role (migration 260): no writes, no secret
 *                   columns, no access to the key / audit tables. It is wrapped
 *                   in a sub-select and sent as ONE parameterised statement, so
 *                   a second statement can't ride along.
 */

import { getDbAsync } from '@/lib/db';

const STATEMENT_TIMEOUT = '25s';

type Row = Record<string, unknown>;

/** Our own read-only SQL. `params` are bound ($1, $2, …). */
export async function readQuery<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const sql = await getDbAsync();
  return sql.begin('read only', async (tx) => {
    await tx.unsafe(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`);
    return (await tx.unsafe(text, params as never[])) as unknown as T[];
  }) as Promise<T[]>;
}

// ── Free-form SQL from the agent ─────────────────────────────────────────────

/**
 * Functions that could change the session, read files, reach other databases
 * or stall a connection. The READ ONLY transaction and the role are the real
 * walls; this list closes the one door a role switch leaves (set_config can
 * change `role` back) and a few ways to tie up the database.
 */
const BLOCKED_FUNCTIONS =
  /\b(set_config|query_to_xml|query_to_json|query_to_xml_and_xmlschema|table_to_xml\w*|cursor_to_xml\w*|schema_to_xml\w*|database_to_xml\w*|dblink\w*|pg_read_\w+|pg_ls_\w+|pg_stat_file|lo_\w+|pg_sleep\w*|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_notify|pg_advisory\w*|pg_switch_wal|pg_create_\w+|pg_drop_\w+|pg_logical_\w+)\s*\(/i;

/** Strip string literals and comments so the checks below see only SQL. */
function codeOnly(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

export class AgentSqlError extends Error {}

function vetAgentSql(raw: string): string {
  const sql = raw.trim().replace(/;+\s*$/, '').trim();
  if (!sql) throw new AgentSqlError('sql is required');
  if (sql.length > 20_000) throw new AgentSqlError('sql is too long (20,000 characters max)');
  const code = codeOnly(sql);
  if (code.includes(';')) throw new AgentSqlError('Only one statement is allowed (no semicolons).');
  if (!/^\s*\(*\s*(select|with|values|table)\b/i.test(code)) {
    throw new AgentSqlError('Only read queries are allowed: start with SELECT or WITH.');
  }
  if (/\bU&['"]/i.test(sql)) throw new AgentSqlError('Unicode-escaped identifiers are not allowed.');
  // Writes, DDL and row locks need no keyword list: the READ ONLY transaction
  // and the mcp_readonly role refuse them, and a data-modifying WITH can't sit
  // inside the sub-select this query is wrapped in.
  // Quotes removed so a quoted name ("set_config"(…)) is caught too.
  if (BLOCKED_FUNCTIONS.test(code.replace(/"/g, ''))) throw new AgentSqlError('That function is not available to agents.');
  return sql;
}

let grantsRefresh: Promise<void> | null = null;

/**
 * New tables are invisible to mcp_readonly until they're granted. Once per
 * process, grant any table created since (cheap: existing tables are skipped).
 */
function refreshGrantsOnce(): Promise<void> {
  grantsRefresh ??= (async () => {
    const sql = await getDbAsync();
    await sql.unsafe('select public.mcp_readonly_refresh_grants(false)');
  })().catch((err) => {
    grantsRefresh = null;
    console.warn('[mcp] mcp_readonly grant refresh failed:', err instanceof Error ? err.message : err);
  });
  return grantsRefresh;
}

export interface AgentSqlResult {
  columns: string[];
  rows: Row[];
  hasMore: boolean;
}

export async function runAgentSql(raw: string, limit: number, offset: number): Promise<AgentSqlResult> {
  const query = vetAgentSql(raw);
  await refreshGrantsOnce();
  const sql = await getDbAsync();
  try {
    const rows = (await sql.begin('read only', async (tx) => {
      await tx.unsafe(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`);
      await tx.unsafe('set local role mcp_readonly');
      // One parameterised statement: the extended protocol refuses a second one.
      return tx.unsafe(`select * from (\n${query}\n) as agent_query limit $1 offset $2`, [limit + 1, offset]);
    })) as unknown as Row[];
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return { columns, rows: rows.slice(0, limit), hasMore: rows.length > limit };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/role "mcp_readonly" does not exist/i.test(msg)) {
      throw new AgentSqlError('run_sql is not set up yet (database migration 260 has not been applied).');
    }
    if (/permission denied/i.test(msg)) {
      throw new AgentSqlError(`${msg}. Secret columns (tokens, passwords, keys) and the MCP key/audit tables are not readable; use describe_table to see what is.`);
    }
    throw new AgentSqlError(msg);
  }
}
