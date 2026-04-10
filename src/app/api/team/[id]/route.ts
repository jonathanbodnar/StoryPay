import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const EDGE_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/team-members`;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

function edgeHeaders(venueId: string) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ANON_KEY}`,
    'x-venue-id': venueId,
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const res = await fetch(EDGE_URL, {
    method: 'PATCH',
    headers: edgeHeaders(venueId),
    body: JSON.stringify({ id, ...body }),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const res = await fetch(EDGE_URL, {
    method: 'DELETE',
    headers: edgeHeaders(venueId),
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
