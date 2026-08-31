export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { hasAdminTabAccess } from '@/lib/admin-identity';

/**
 * Super-admin Projects board data.
 *
 * GET   → { stages, cards } — every private-client venue placed on the board
 *         plus live onboarding / A2P / guide / ads status signals.
 * PATCH → move a card (stageId + orderedIds) OR save a card's notes.
 *
 * Uses the direct Postgres client (getDbAsync) because admin_project_stages,
 * venue_ad_creatives and the new venues.project_* columns may not be in
 * PostgREST's schema cache yet.
 */

interface StageRow {
  id: string;
  key: string;
  label: string;
  color: string;
  position: number;
}

export async function GET(request: NextRequest) {
  if (!(await hasAdminTabAccess('projects'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Venue search (for the "add existing venue" picker) ──────────────────────
  const q = (request.nextUrl.searchParams.get('q') || '').trim();
  if (q) {
    try {
      const sql = await getDbAsync();
      const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`;
      const results = await sql`
        SELECT
          v.id,
          v.name,
          v.slug,
          COALESCE(v.logo_url, v.brand_logo_url)             AS logo_url,
          COALESCE(v.city, v.location_city, v.brand_city)    AS city,
          COALESCE(v.state, v.location_state, v.brand_state) AS state,
          v.is_private_client,
          v.project_stage_id,
          (v.project_stage_id IS NOT NULL) AS on_board
        FROM venues v
        WHERE v.name ILIKE ${like}
        ORDER BY (v.project_stage_id IS NOT NULL) ASC, v.name ASC
        LIMIT 20
      `;
      return NextResponse.json({ results });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin/projects][search]', msg);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  try {
    const sql = await getDbAsync();

    const stages = (await sql`
      SELECT id, key, label, color, position
      FROM admin_project_stages
      ORDER BY position ASC, label ASC
    `) as unknown as StageRow[];

    const cards = await sql`
      SELECT
        v.id,
        v.name,
        v.slug,
        COALESCE(v.logo_url, v.brand_logo_url)                 AS logo_url,
        v.cover_image_url,
        COALESCE(v.city, v.location_city, v.brand_city)        AS city,
        COALESCE(v.state, v.location_state, v.brand_state)     AS state,
        v.is_private_client,
        v.onboarding_status,
        v.onboarding_completed,
        v.setup_completed,
        v.a2p_brand_status,
        v.a2p_campaign_status,
        v.a2p_verified,
        v.venue_concierge,
        v.ai_concierge_enabled,
        v.project_stage_id,
        v.project_position,
        v.created_at,
        (pg.id IS NOT NULL AND (pg.enabled IS TRUE OR pg.use_custom_pricing_guide IS TRUE)) AS pricing_guide_ready,
        COALESCE(ac.cnt, 0)::int                               AS ad_creatives_count,
        COALESCE(nc.cnt, 0)::int                               AS notes_count
      FROM venues v
      LEFT JOIN venue_pricing_guides pg ON pg.venue_id = v.id
      LEFT JOIN (
        SELECT venue_id, count(*) AS cnt
        FROM venue_ad_creatives
        GROUP BY venue_id
      ) ac ON ac.venue_id = v.id
      LEFT JOIN (
        SELECT venue_id, count(*) AS cnt
        FROM admin_project_notes
        GROUP BY venue_id
      ) nc ON nc.venue_id = v.id
      WHERE v.project_stage_id IS NOT NULL
      ORDER BY v.project_position ASC, v.created_at ASC
    `;

    return NextResponse.json({ stages, cards });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/projects][GET]', msg);
    // Surface a friendly hint when the migration hasn't been applied yet.
    if (/admin_project_stages|project_stage_id|venue_ad_creatives/.test(msg)) {
      return NextResponse.json(
        { error: 'Projects schema not found — run migration 207.', detail: msg },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!(await hasAdminTabAccess('projects'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    venueId?: string;
    stageId?: string | null;
    orderedIds?: string[];
    action?: 'move' | 'remove';
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const venueId = (body.venueId || '').trim();
  if (!venueId) {
    return NextResponse.json({ error: 'venueId required' }, { status: 400 });
  }

  try {
    const sql = await getDbAsync();

    // Remove a venue from the board (only detaches non-private clients from view;
    // private clients always surface in the first column).
    if (body.action === 'remove') {
      await sql`
        UPDATE venues
        SET project_stage_id = NULL, project_position = 0
        WHERE id = ${venueId}
      `;
      return NextResponse.json({ ok: true });
    }

    // Move + reorder within a destination column. Adding an existing venue is the
    // same operation (set its stage), so any venue id is allowed here.
    const stageId = body.stageId ?? null;
    const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds : [venueId];

    await sql.begin(async (tx) => {
      await tx`
        UPDATE venues
        SET project_stage_id = ${stageId}
        WHERE id = ${venueId}
      `;
      // Persist the vertical order of the destination column.
      for (let i = 0; i < orderedIds.length; i++) {
        await tx`
          UPDATE venues
          SET project_position = ${i}, project_stage_id = ${stageId}
          WHERE id = ${orderedIds[i]}
        `;
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/projects][PATCH]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
