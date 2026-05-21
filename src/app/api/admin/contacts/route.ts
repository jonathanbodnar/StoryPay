import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import {
  loadAllContacts,
  contactMatches,
  CONTACT_TYPES,
  type ContactType,
} from '@/lib/admin-contacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/contacts
 *
 * Master directory of every contact across StoryVenue.
 *
 * Query params:
 *   - type    : Comma-separated list of {@link ContactType}. Optional. Default: all.
 *   - search  : Substring filter across name/email/phone/city/state/role/venue.
 *   - blocked : 'true' to return only currently-blocked contacts.
 *   - limit   : Cap the response array (default 5000).
 */
export async function GET(req: NextRequest) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const typeParam = (searchParams.get('type') ?? '').trim();
  const search = (searchParams.get('search') ?? '').trim();
  const onlyBlocked = (searchParams.get('blocked') ?? '').toLowerCase() === 'true';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '5000', 10) || 5000, 20000);

  let wantTypes: ContactType[] | undefined;
  if (typeParam) {
    const allowed = new Set<string>(CONTACT_TYPES);
    wantTypes = typeParam.split(',').map((t) => t.trim()).filter((t) => allowed.has(t)) as ContactType[];
    if (wantTypes.length === 0) {
      return NextResponse.json({ contacts: [], errors: [], total: 0 });
    }
  }

  const { contacts, errors } = await loadAllContacts({ types: wantTypes });

  const filtered = contacts.filter((c) => {
    if (onlyBlocked && !c.blocked) return false;
    if (!contactMatches(c, search)) return false;
    return true;
  });

  return NextResponse.json({
    contacts: filtered.slice(0, limit),
    errors,
    total: filtered.length,
  });
}
