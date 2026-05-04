/**
 * Atomically activate a specific ai_config version.
 *
 *   POST /api/admin/ai-concierge/configs/[id]/activate
 *
 * The `ai_config_only_one_active` partial unique index guarantees at most
 * one row has is_active=TRUE. Setting a new row to active without first
 * deactivating the current active one would violate the constraint.
 *
 * We use postgres.js's `sql.begin()` to run both updates inside a single
 * transaction so the cron never observes a half-flipped state. If the cron
 * happens to read between our deactivate and activate it would briefly
 * see "no active config" and skip the tick — which is preferable to
 * processing with an uncommitted in-flight change.
 *
 * Cache invalidation: we clear the in-process loadActiveAiConfig cache.
 * Other Node instances pick up the change within 60 seconds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { getDbAsync } from '@/lib/db';
import { clearAiConfigCache } from '@/lib/ai-concierge/prompt-builder';

export const dynamic = 'force-dynamic';

interface ActivateRow {
  id:        string;
  version:   number;
  is_active: boolean;
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const sql = await getDbAsync();

  try {
    // Atomic flip in a single transaction.
    const result = await sql.begin(async (tx) => {
      // 1. Verify target exists
      const target = await tx<ActivateRow[]>`
        SELECT id, version, is_active
        FROM   public.ai_config
        WHERE  id = ${id}
        LIMIT  1
      `;
      if (target.length === 0) {
        // Sentinel: caller will translate to 404
        throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND' });
      }

      const row = target[0];
      if (row.is_active) {
        // Already active — return a no-op success.
        return { ...row, alreadyActive: true };
      }

      // 2. Deactivate current active (if any). The partial unique index lets
      //    this be a single UPDATE on a small WHERE clause.
      await tx`
        UPDATE public.ai_config
        SET    is_active  = FALSE,
               updated_at = NOW()
        WHERE  is_active  = TRUE
      `;

      // 3. Activate the target. If this throws (constraint, FK, etc.) the
      //    BEGIN block rolls back the deactivate above.
      const updated = await tx<ActivateRow[]>`
        UPDATE public.ai_config
        SET    is_active  = TRUE,
               updated_at = NOW()
        WHERE  id         = ${id}
        RETURNING id, version, is_active
      `;
      return { ...updated[0], alreadyActive: false };
    });

    clearAiConfigCache();
    return NextResponse.json({
      row:           result,
      alreadyActive: result.alreadyActive,
    });
  } catch (e) {
    if (e instanceof Error && (e as Error & { code?: string }).code === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }
    const msg = e instanceof Error ? e.message : 'Activation failed';
    console.error('[ai-concierge/configs/activate]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
