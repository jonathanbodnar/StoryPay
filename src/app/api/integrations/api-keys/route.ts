export const dynamic = 'force-dynamic';
import { NextResponse, type NextRequest } from 'next/server';
import { requireVenueId } from '@/lib/auth-helpers';
import { createApiKey, listApiKeys } from '@/lib/api-keys';

/** GET — list this venue's API keys (no plaintext). */
export async function GET() {
  try {
    const venueId = await requireVenueId();
    const rows = await listApiKeys(venueId);
    return NextResponse.json({
      keys: rows.map((r) => ({
        id: r.id,
        name: r.name,
        key_prefix: r.key_prefix,
        source: r.source,
        scopes: r.scopes,
        last_used_at: r.last_used_at,
        created_at: r.created_at,
        active: true,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unauthorized';
    return NextResponse.json({ error: msg }, { status: msg === 'Unauthorized' ? 401 : 500 });
  }
}

/** POST — create a new API key. The plaintext is returned ONCE. */
export async function POST(request: NextRequest) {
  try {
    const venueId = await requireVenueId();
    const body = (await request.json().catch(() => ({}))) as { name?: string; source?: string };
    const result = await createApiKey(venueId, {
      name: body.name,
      source: body.source || 'manual',
    });
    return NextResponse.json({
      plaintext: result.plaintext,
      key: {
        id: result.row.id,
        name: result.row.name,
        key_prefix: result.row.key_prefix,
        source: result.row.source,
        scopes: result.row.scopes,
        created_at: result.row.created_at,
        active: true,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unauthorized';
    return NextResponse.json({ error: msg }, { status: msg === 'Unauthorized' ? 401 : 500 });
  }
}
