import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { parseSegment } from '@/lib/marketing-email-schema';
import { countCampaignRecipients } from '@/lib/marketing-email-audience';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Recipient-count preview for an arbitrary CampaignSegment payload. Used
 * by the segment editor and the campaign audience picker so users can see
 * "this would send to N people" before saving. */
export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { segment?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const segment = parseSegment(body.segment);
  const count = await countCampaignRecipients(venueId, segment);
  return NextResponse.json({ count });
}
