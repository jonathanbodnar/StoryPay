import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * DDL for the directory integration (storyvenue.com <-> StoryPay).
 *
 * `venue_listings` holds the public directory listing for a StoryPay venue.
 * `leads` captures inquiries from the directory lead form.
 *
 * Runs the statements directly via the pg wire protocol (bypassing PostgREST
 * so the schema is immediately usable after creation).
 */
const STATEMENTS: { name: string; sql: string }[] = [
  {
    name: 'venue_listings',
    sql: `
      CREATE TABLE IF NOT EXISTS public.venue_listings (
        id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        storypay_venue_id     uuid NOT NULL UNIQUE REFERENCES public.venues(id) ON DELETE CASCADE,
        slug                  text UNIQUE,
        name                  text,
        description           text,
        venue_type            text,
        location_full         text,
        location_city         text,
        location_state        text,
        lat                   double precision,
        lng                   double precision,
        capacity_min          integer,
        capacity_max          integer,
        price_min             integer,
        price_max             integer,
        indoor_outdoor        text,
        features              jsonb NOT NULL DEFAULT '[]'::jsonb,
        cover_image_url       text,
        gallery_images        jsonb NOT NULL DEFAULT '[]'::jsonb,
        availability_notes    text,
        is_published          boolean NOT NULL DEFAULT false,
        onboarding_completed  boolean NOT NULL DEFAULT false,
        notification_email    text,
        email_notifications   boolean NOT NULL DEFAULT true,
        created_at            timestamptz NOT NULL DEFAULT now(),
        updated_at            timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE public.venue_listings ENABLE ROW LEVEL SECURITY;
      CREATE INDEX IF NOT EXISTS venue_listings_published_idx
        ON public.venue_listings (is_published) WHERE is_published = true;
      CREATE INDEX IF NOT EXISTS venue_listings_location_idx
        ON public.venue_listings (location_state, location_city);
    `,
  },
  {
    name: 'venue_listings_published_select_policy',
    sql: `
      DROP POLICY IF EXISTS venue_listings_public_read ON public.venue_listings;
      CREATE POLICY venue_listings_public_read
        ON public.venue_listings
        FOR SELECT
        USING (is_published = true);
    `,
  },
  {
    name: 'leads',
    sql: `
      CREATE TABLE IF NOT EXISTS public.leads (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_listing_id   uuid REFERENCES public.venue_listings(id) ON DELETE SET NULL,
        storypay_venue_id  uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
        name               text NOT NULL,
        email              text NOT NULL,
        phone              text,
        event_date         date,
        guest_count        integer,
        booking_timeline   text,
        message            text,
        notes              text,
        status             text NOT NULL DEFAULT 'new',
        source             text NOT NULL DEFAULT 'directory',
        created_at         timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
      CREATE INDEX IF NOT EXISTS leads_venue_listing_idx  ON public.leads (venue_listing_id);
      CREATE INDEX IF NOT EXISTS leads_storypay_venue_idx ON public.leads (storypay_venue_id);
      CREATE INDEX IF NOT EXISTS leads_status_idx         ON public.leads (status);
      CREATE INDEX IF NOT EXISTS leads_created_at_idx     ON public.leads (created_at DESC);
    `,
  },
  {
    name: 'updated_at_trigger_fn',
    sql: `
      CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
      RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$;
    `,
  },
  {
    name: 'venue_listings_updated_at_trigger',
    sql: `
      DROP TRIGGER IF EXISTS venue_listings_set_updated_at ON public.venue_listings;
      CREATE TRIGGER venue_listings_set_updated_at
        BEFORE UPDATE ON public.venue_listings
        FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();
    `,
  },
];

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return Boolean(token && token === process.env.ADMIN_SECRET);
}

export async function POST() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = getDb();
  const results: { name: string; status: 'ok' | 'error'; error?: string }[] = [];

  for (const stmt of STATEMENTS) {
    try {
      await sql.unsafe(stmt.sql);
      results.push({ name: stmt.name, status: 'ok' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[setup-directory-db] ${stmt.name} failed:`, message);
      results.push({ name: stmt.name, status: 'error', error: message });
    }
  }

  const hadErrors = results.some((r) => r.status === 'error');
  return NextResponse.json({ ok: !hadErrors, results }, { status: hadErrors ? 500 : 200 });
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    info: 'POST to this endpoint to run the directory schema migration.',
    statements: STATEMENTS.map((s) => s.name),
  });
}
