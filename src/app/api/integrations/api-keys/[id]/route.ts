export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireVenueId } from '@/lib/auth-helpers';
import { revokeApiKey } from '@/lib/api-keys';

/** DELETE — revoke an API key. Future requests using it will 401. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const venueId = await requireVenueId();
    const { id } = await context.params;
    await revokeApiKey(venueId, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unauthorized';
    return NextResponse.json({ error: msg }, { status: msg === 'Unauthorized' ? 401 : 500 });
  }
}
