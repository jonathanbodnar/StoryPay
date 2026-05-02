export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbAsync();

    // ── Parent table ───────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS public.venue_pricing_guides (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_id UUID NOT NULL UNIQUE
          REFERENCES public.venues(id) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        cover_image_url TEXT,
        cover_generated_at TIMESTAMPTZ,
        cover_source_image_url TEXT,
        congratulatory_message TEXT,
        gallery JSONB NOT NULL DEFAULT '[]'::jsonb,
        about_venue TEXT,
        accommodations_text TEXT,
        accommodations_image_url TEXT,
        pricing_intro TEXT,
        reviews JSONB NOT NULL DEFAULT '[]'::jsonb,
        availability_text TEXT,
        availability_image_url TEXT,
        cta_headline TEXT,
        cta_body TEXT,
        cta_button_label TEXT NOT NULL DEFAULT 'Schedule a tour',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS venue_pricing_guides_venue_idx
        ON public.venue_pricing_guides(venue_id)
    `;

    // ── Spaces child table ─────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS public.venue_pricing_guide_spaces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pricing_guide_id UUID NOT NULL
          REFERENCES public.venue_pricing_guides(id) ON DELETE CASCADE,
        name TEXT,
        description TEXT,
        capacity TEXT,
        image_url TEXT,
        position INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS venue_pricing_guide_spaces_guide_pos_idx
        ON public.venue_pricing_guide_spaces(pricing_guide_id, position)
    `;

    // ── Packages child table ───────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS public.venue_pricing_guide_packages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pricing_guide_id UUID NOT NULL
          REFERENCES public.venue_pricing_guides(id) ON DELETE CASCADE,
        name TEXT,
        price_label TEXT,
        description TEXT,
        included_items JSONB NOT NULL DEFAULT '[]'::jsonb,
        position INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS venue_pricing_guide_packages_guide_pos_idx
        ON public.venue_pricing_guide_packages(pricing_guide_id, position)
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({
      success: true,
      message:
        'Migration 091 applied — Pricing Guide tables created (venue_pricing_guides, venue_pricing_guide_spaces, venue_pricing_guide_packages).',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-091]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
