/**
 * POST /api/admin/support/canned-replies/[id]/render
 *
 * Resolves a canned-reply template against a specific thread and returns the
 * fully merge-substituted body. Also bumps use_count for analytics.
 *
 * Body: { threadId: string; agentName?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { renderCannedReply } from '@/lib/support/canned-replies';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await verifySupportAccess();
  if (!auth.isSuperAdmin && !auth.agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  let payload: { threadId?: string; agentName?: string };
  try { payload = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const threadId = (payload.threadId || '').trim();
  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });

  const { data: tpl } = await supabaseAdmin
    .from('support_canned_replies')
    .select('id, body, use_count')
    .eq('id', id)
    .maybeSingle();

  if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const t = tpl as { id: string; body: string; use_count: number };

  const result = await renderCannedReply(t.body, {
    threadId,
    agentName: payload.agentName?.trim() || auth.agent?.name,
  });

  // Best-effort analytics bump — not blocking
  void supabaseAdmin
    .from('support_canned_replies')
    .update({ use_count: (t.use_count ?? 0) + 1 })
    .eq('id', id);

  return NextResponse.json({ body: result.body, unknown: result.unknown });
}
