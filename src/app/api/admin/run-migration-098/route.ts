export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

/**
 * Migration 098 — AI Concierge feature
 *
 * Adds the schema for the per-bride AI SMS follow-up feature:
 *   - venues columns + eligibility constraint
 *   - leads AI state machine columns + activity timestamps + indexes
 *   - conversation_messages.sender_kind extended to 'ai'
 *   - trigger maintaining leads.last_inbound_at / last_outbound_at
 *   - new tables: ai_config, handoff_rules, ai_runs, ai_state_transitions
 *   - seed data: ai_config v1 (active) and 8 starter handoff_rules rows
 *
 * Idempotent: safe to re-run. The migration uses IF NOT EXISTS guards,
 * conditional constraint adds, and NOT EXISTS guards on every seed insert.
 *
 * Because the SQL contains long multi-line dollar-quoted strings (the AI
 * personality / goals / guardrails / system prompt template), we read the
 * canonical migration file from disk and execute it as a single statement
 * batch via postgres.js's `unsafe()`.
 */
export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbAsync();

    const sqlPath = path.join(process.cwd(), 'migrations', '098_ai_concierge.sql');
    const migrationSql = await fs.readFile(sqlPath, 'utf8');

    // postgres.js: `sql.unsafe(...)` runs the raw string as-is, supporting
    // multiple statements in one call. This is required because the file
    // includes dollar-quoted text blobs that don't fit a tagged template.
    await sql.unsafe(migrationSql);

    return NextResponse.json({
      success: true,
      message:
        'Migration 098 applied — AI Concierge schema (venues + leads columns, conversation_messages.sender_kind extended, ai_config / handoff_rules / ai_runs / ai_state_transitions tables seeded).',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-098]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
