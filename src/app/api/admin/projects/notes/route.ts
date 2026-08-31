export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { getAdminIdentity } from '@/lib/admin-identity';

/**
 * Timestamped project notes for a venue card.
 * GET  ?venueId=  → notes newest-first.
 * POST { venueId, body } → append a note (author stamped from the session).
 */

interface NoteRow {
  id: string;
  venue_id: string;
  body: string;
  author: string | null;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const identity = await getAdminIdentity();
  if (!identity.allowedTabs.has('projects')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const venueId = (request.nextUrl.searchParams.get('venueId') || '').trim();
  if (!venueId) return NextResponse.json({ error: 'venueId required' }, { status: 400 });

  try {
    const sql = await getDbAsync();
    const notes = (await sql`
      SELECT id, venue_id, body, author, created_at
      FROM admin_project_notes
      WHERE venue_id = ${venueId}
      ORDER BY created_at DESC
      LIMIT 200
    `) as unknown as NoteRow[];
    return NextResponse.json({ notes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/projects/notes][GET]', msg);
    if (/admin_project_notes/.test(msg)) {
      return NextResponse.json({ error: 'Notes schema not found — run migration 208.', detail: msg }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const identity = await getAdminIdentity();
  if (!identity.allowedTabs.has('projects')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: { venueId?: string; body?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const venueId = (payload.venueId || '').trim();
  const body = (payload.body || '').trim();
  if (!venueId || !body) {
    return NextResponse.json({ error: 'venueId and body required' }, { status: 400 });
  }

  const author = identity.isMasterSuperAdmin
    ? 'Super admin'
    : identity.member?.name || identity.member?.email || 'Team member';

  try {
    const sql = await getDbAsync();
    const rows = (await sql`
      INSERT INTO admin_project_notes (venue_id, body, author)
      VALUES (${venueId}, ${body.slice(0, 4000)}, ${author})
      RETURNING id, venue_id, body, author, created_at
    `) as unknown as NoteRow[];
    return NextResponse.json({ note: rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/projects/notes][POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
