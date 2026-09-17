export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { getAdminIdentity } from '@/lib/admin-identity';
import { PROJECT_CHECKLIST_KEYS, normalizeChecklist } from '@/lib/project-checklist';

/**
 * Per-venue onboarding checklist for a Projects board card.
 * GET   ?venueId=            → { checklist: { [key]: boolean } }
 * PATCH { venueId, key, done } → toggle one item, returns the updated map.
 *
 * Stored on venues.project_checklist (JSONB) so the same completion state is
 * available anywhere in the SaaS. Uses the direct Postgres client (service role)
 * — the column is never exposed to anon/authenticated.
 */

interface VenueChecklistRow {
  project_checklist: Record<string, unknown> | null;
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
    const rows = (await sql`
      SELECT project_checklist FROM venues WHERE id = ${venueId} LIMIT 1
    `) as unknown as VenueChecklistRow[];
    if (!rows.length) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    return NextResponse.json({ checklist: normalizeChecklist(rows[0].project_checklist) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/projects/checklist][GET]', msg);
    if (/project_checklist/.test(msg)) {
      return NextResponse.json({ error: 'Checklist schema not found — run migration 250.', detail: msg }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const identity = await getAdminIdentity();
  if (!identity.allowedTabs.has('projects')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: { venueId?: string; key?: string; done?: boolean };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const venueId = (payload.venueId || '').trim();
  const key = (payload.key || '').trim();
  const done = payload.done === true;
  if (!venueId || !key) {
    return NextResponse.json({ error: 'venueId and key required' }, { status: 400 });
  }
  if (!PROJECT_CHECKLIST_KEYS.has(key)) {
    return NextResponse.json({ error: 'Unknown checklist item' }, { status: 400 });
  }

  try {
    const sql = await getDbAsync();
    // Merge the single key into the existing map (defaulting null → {}).
    // Cast the key to ::text — jsonb_build_object is variadic "any", so without
    // an explicit type Postgres can't infer the parameter's type and errors with
    // "could not determine data type of parameter $1".
    const rows = (await sql`
      UPDATE venues
      SET project_checklist =
        COALESCE(project_checklist, '{}'::jsonb) || jsonb_build_object(${key}::text, ${done}::boolean)
      WHERE id = ${venueId}
      RETURNING project_checklist
    `) as unknown as VenueChecklistRow[];
    if (!rows.length) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    return NextResponse.json({ checklist: normalizeChecklist(rows[0].project_checklist) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/projects/checklist][PATCH]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
