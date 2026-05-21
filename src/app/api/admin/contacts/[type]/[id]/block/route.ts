import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { CONTACT_TYPES, type ContactType } from '@/lib/admin-contacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CONTACT_TYPE_SET = new Set<string>(CONTACT_TYPES);

/** Far-future date used as a "permanent" block timestamp. */
const PERMANENT = '2999-12-31T00:00:00Z';

interface BlockBody {
  /** 'block' or 'unblock'. */
  action?: string;
  /** How long to block: 'permanent', or an ISO timestamp, or '24h' / '7d' / '30d'. */
  duration?: string;
  /** Internal note explaining why. */
  reason?: string;
}

function parseDuration(d: string | undefined): string {
  if (!d || d === 'permanent') return PERMANENT;
  const m = d.match(/^(\d+)\s*(h|d|w)$/i);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const ms =
      unit === 'h' ? n * 60 * 60 * 1000 :
      unit === 'd' ? n * 24 * 60 * 60 * 1000 :
      n * 7 * 24 * 60 * 60 * 1000;
    return new Date(Date.now() + ms).toISOString();
  }
  // Otherwise assume an ISO timestamp
  const parsed = Date.parse(d);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return PERMANENT;
}

function authBanDuration(untilIso: string | null): string {
  if (!untilIso) return 'none';
  const ms = Date.parse(untilIso) - Date.now();
  if (ms <= 0) return 'none';
  const hours = Math.max(1, Math.ceil(ms / (60 * 60 * 1000)));
  // Supabase accepts integer hours format
  return `${hours}h`;
}

/**
 * POST /api/admin/contacts/[type]/[id]/block
 *
 * Block a contact (temporary or permanent), or unblock if action='unblock'.
 * For auth-backed contacts we set auth.users.banned_until via Supabase.
 * For tables with a blocked_until column we write that directly.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { type, id } = await params;
  if (!CONTACT_TYPE_SET.has(type)) {
    return NextResponse.json({ error: 'Unknown contact type' }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const t = type as ContactType;

  let body: BlockBody = {};
  try { body = (await req.json()) as BlockBody; } catch { /* allow empty */ }
  const action = (body.action ?? 'block').toLowerCase();
  const reason = typeof body.reason === 'string' ? body.reason.trim() : null;
  const blockedUntilIso = action === 'unblock' ? null : parseDuration(body.duration);

  // ── venue owner ──────────────────────────────────────────────────────────
  if (t === 'venue_owner') {
    const updates: Record<string, unknown> = {
      blocked_until: blockedUntilIso,
      blocked_reason: blockedUntilIso ? reason : null,
    };
    const { error } = await supabaseAdmin.from('venues').update(updates).eq('id', id);
    if (error && /blocked_until|blocked_reason/i.test(error.message)) {
      return NextResponse.json(
        { error: 'Missing blocked_until column — run migration 138 first.', migrationRequired: true },
        { status: 500 },
      );
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Also ban the linked auth user (so future Supabase sessions are gone)
    try {
      const { data: venue } = await supabaseAdmin
        .from('venues').select('owner_id').eq('id', id).maybeSingle();
      const ownerId = (venue as { owner_id?: string | null } | null)?.owner_id;
      if (ownerId) {
        await supabaseAdmin.auth.admin.updateUserById(ownerId, {
          ban_duration: authBanDuration(blockedUntilIso),
        } as Parameters<typeof supabaseAdmin.auth.admin.updateUserById>[1]);
      }
    } catch (e) {
      console.warn('[contacts/block venue_owner] auth ban failed (non-fatal):', e);
    }

    // Clear any active impersonation cookies — not directly possible from a
    // different browser, but we can wipe ours so the admin doesn't keep
    // working as them.
    return NextResponse.json({ ok: true, blocked_until: blockedUntilIso });
  }

  // ── couple — supabase auth ban + profile column ─────────────────────────
  if (t === 'couple') {
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(id, {
      ban_duration: authBanDuration(blockedUntilIso),
    } as Parameters<typeof supabaseAdmin.auth.admin.updateUserById>[1]);
    if (authErr) {
      // Field may not be supported on older supabase-js versions; fall through
      console.warn('[contacts/block couple] auth ban failed (non-fatal):', authErr);
    }
    const updates = { blocked_until: blockedUntilIso, blocked_reason: blockedUntilIso ? reason : null };
    const { error } = await supabaseAdmin.from('couple_profiles').update(updates).eq('id', id);
    if (error && /blocked_until|blocked_reason/i.test(error.message)) {
      return NextResponse.json(
        { error: 'Missing blocked_until column — run migration 138 first.', migrationRequired: true },
        { status: 500 },
      );
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, blocked_until: blockedUntilIso });
  }

  // ── venue team — flip status + blocked_until ────────────────────────────
  if (t === 'venue_team') {
    const updates: Record<string, unknown> = {
      blocked_until: blockedUntilIso,
      blocked_reason: blockedUntilIso ? reason : null,
      status: blockedUntilIso ? 'blocked' : 'active',
    };
    let { error } = await supabaseAdmin.from('venue_team_members').update(updates).eq('id', id);
    if (error && /blocked_until|blocked_reason/i.test(error.message)) {
      // Fall back to just status when migration not applied
      delete updates.blocked_until;
      delete updates.blocked_reason;
      const retry = await supabaseAdmin.from('venue_team_members').update(updates).eq('id', id);
      error = retry.error ?? null;
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, blocked_until: blockedUntilIso });
  }

  // ── admin team member — toggle active flag ──────────────────────────────
  if (t === 'admin_team') {
    const { error } = await supabaseAdmin
      .from('support_team_members')
      .update({ active: !blockedUntilIso })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, active: !blockedUntilIso });
  }

  return NextResponse.json(
    { error: 'This contact type cannot be blocked. Use Delete instead.' },
    { status: 400 },
  );
}
