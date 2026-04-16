import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getVenueId } from '@/lib/auth-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const sql = getDb();
    const [row] = await sql`
      SELECT vc.*,
        CASE WHEN s.id IS NOT NULL THEN
          json_build_object('id', s.id, 'name', s.name, 'color', s.color)
        ELSE NULL END AS venue_spaces
      FROM venue_customers vc
      LEFT JOIN venue_spaces s ON s.id = vc.wedding_space_id
      WHERE vc.id = ${id} AND vc.venue_id = ${venueId}
    `;
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = await request.json();
  const b = body;
  const has = (k: string) => k in b;

  try {
    const sql = getDb();
    const [row] = await sql`
      UPDATE venue_customers SET
        first_name         = CASE WHEN ${has('first_name')}         THEN ${b.first_name         ?? null} ELSE first_name         END,
        last_name          = CASE WHEN ${has('last_name')}          THEN ${b.last_name          ?? null} ELSE last_name          END,
        phone              = CASE WHEN ${has('phone')}              THEN ${b.phone              ?? null} ELSE phone              END,
        partner_first_name = CASE WHEN ${has('partner_first_name')} THEN ${b.partner_first_name ?? null} ELSE partner_first_name END,
        partner_last_name  = CASE WHEN ${has('partner_last_name')}  THEN ${b.partner_last_name  ?? null} ELSE partner_last_name  END,
        partner_email      = CASE WHEN ${has('partner_email')}      THEN ${b.partner_email      ?? null} ELSE partner_email      END,
        partner_phone      = CASE WHEN ${has('partner_phone')}      THEN ${b.partner_phone      ?? null} ELSE partner_phone      END,
        wedding_date       = CASE WHEN ${has('wedding_date')}       THEN ${b.wedding_date       ?? null}::date ELSE wedding_date  END,
        wedding_space_id   = CASE WHEN ${has('wedding_space_id')}   THEN ${b.wedding_space_id   ?? null}::uuid ELSE wedding_space_id END,
        ceremony_type      = CASE WHEN ${has('ceremony_type')}      THEN ${b.ceremony_type      ?? null} ELSE ceremony_type      END,
        guest_count        = CASE WHEN ${has('guest_count')}        THEN ${b.guest_count        ?? null} ELSE guest_count        END,
        rehearsal_date     = CASE WHEN ${has('rehearsal_date')}     THEN ${b.rehearsal_date     ?? null}::date ELSE rehearsal_date END,
        coordinator_name   = CASE WHEN ${has('coordinator_name')}   THEN ${b.coordinator_name   ?? null} ELSE coordinator_name   END,
        coordinator_phone  = CASE WHEN ${has('coordinator_phone')}  THEN ${b.coordinator_phone  ?? null} ELSE coordinator_phone  END,
        catering_notes     = CASE WHEN ${has('catering_notes')}     THEN ${b.catering_notes     ?? null} ELSE catering_notes     END,
        referral_source    = CASE WHEN ${has('referral_source')}    THEN ${b.referral_source    ?? null} ELSE referral_source    END,
        pipeline_stage     = CASE WHEN ${has('pipeline_stage')}     THEN ${b.pipeline_stage     ?? 'inquiry'} ELSE pipeline_stage END,
        updated_at         = now()
      WHERE id = ${id} AND venue_id = ${venueId}
      RETURNING *
    `;
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const spaceRows = row.wedding_space_id
      ? await sql`SELECT id, name, color FROM venue_spaces WHERE id = ${row.wedding_space_id}`
      : [];
    return NextResponse.json({ ...row, venue_spaces: spaceRows[0] ?? null });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
