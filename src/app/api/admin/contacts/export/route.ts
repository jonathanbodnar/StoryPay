import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import {
  loadAllContacts,
  contactMatches,
  CONTACT_TYPES,
  CONTACT_TYPE_LABELS,
  type ContactType,
} from '@/lib/admin-contacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CONTACT_TYPE_SET = new Set<string>(CONTACT_TYPES);

const CSV_HEADERS = [
  'type',
  'first_name',
  'last_name',
  'display_name',
  'email',
  'phone',
  'city',
  'state',
  'role',
  'status',
  'blocked',
  'blocked_until',
  'venue_name',
  'created_at',
  'last_active_at',
];

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * GET /api/admin/contacts/export?type=...&search=...
 *
 * Returns a CSV file of every contact matching the filters. Useful for
 * sending email blasts via Mailchimp, building a custom report, or auditing.
 */
export async function GET(req: NextRequest) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const typeParam = (searchParams.get('type') ?? '').trim();
  const search = (searchParams.get('search') ?? '').trim();
  const onlyBlocked = (searchParams.get('blocked') ?? '').toLowerCase() === 'true';

  let wantTypes: ContactType[] | undefined;
  if (typeParam) {
    wantTypes = typeParam
      .split(',')
      .map((t) => t.trim())
      .filter((t) => CONTACT_TYPE_SET.has(t)) as ContactType[];
    if (wantTypes.length === 0) {
      return new Response('No valid type filter.\n', { status: 400 });
    }
  }

  const { contacts } = await loadAllContacts({ types: wantTypes });
  const filtered = contacts.filter((c) => {
    if (onlyBlocked && !c.blocked) return false;
    if (!contactMatches(c, search)) return false;
    return true;
  });

  const lines: string[] = [];
  lines.push(CSV_HEADERS.join(','));
  for (const c of filtered) {
    lines.push([
      CONTACT_TYPE_LABELS[c.type],
      c.first_name ?? '',
      c.last_name ?? '',
      c.display_name ?? '',
      c.email ?? '',
      c.phone ?? '',
      c.city ?? '',
      c.state ?? '',
      c.role ?? '',
      c.status ?? '',
      c.blocked ? 'yes' : 'no',
      c.blocked_until ?? '',
      c.venue_name ?? '',
      c.created_at ?? '',
      c.last_active_at ?? '',
    ].map(csvEscape).join(','));
  }
  const csv = lines.join('\n') + '\n';

  const slug = (wantTypes ?? CONTACT_TYPES).join('-');
  const ts = new Date().toISOString().slice(0, 10);
  const filename = `storyvenue-contacts-${slug}-${ts}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
