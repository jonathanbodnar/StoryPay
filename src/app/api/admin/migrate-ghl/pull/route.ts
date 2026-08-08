/**
 * GET /api/admin/migrate-ghl/pull?venueId=…
 *
 * One-click "Pull from GHL" for the migration wizard. Fetches every contact
 * from the venue's connected GHL sub-account and returns them in the same
 * shape the wizard's CSV path produces, so the super admin can skip the
 * export/upload/column-map steps entirely.
 *
 * Read-only: this creates no leads and mutates nothing. The wizard's existing
 * preview/commit step (POST /api/admin/migrate-ghl) still performs the import.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminIdentity } from '@/lib/admin-identity';
import { fetchGhlContactsForMigration } from '@/lib/ghl-contacts-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const identity = await getAdminIdentity();
  if (!identity.isMasterSuperAdmin && !identity.member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const venueId = new URL(request.url).searchParams.get('venueId');
  if (!venueId) return NextResponse.json({ error: 'venueId is required' }, { status: 400 });

  try {
    const { contacts, total } = await fetchGhlContactsForMigration(venueId);
    return NextResponse.json({ contacts, total, fetched: contacts.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to pull contacts from GHL';
    console.error('[migrate-ghl/pull]', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
