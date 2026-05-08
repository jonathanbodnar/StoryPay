/**
 * DELETE /api/admin/ai-concierge/leads/[leadId]/tags/[tagId]
 * Removes a tag from a lead.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string; tagId: string }> },
) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leadId, tagId } = await params;

  const { error } = await supabaseAdmin
    .from('lead_tag_assignments')
    .delete()
    .eq('lead_id', leadId)
    .eq('tag_id', tagId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
