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

    // 1. API keys
    await sql`
      CREATE TABLE IF NOT EXISTS public.venue_api_keys (
        id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_id      uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
        name          text        NOT NULL DEFAULT 'API key',
        key_prefix    text        NOT NULL,
        key_hash      text        NOT NULL UNIQUE,
        source        text        NOT NULL DEFAULT 'manual',
        scopes        text[]      NOT NULL DEFAULT ARRAY['read','write']::text[],
        last_used_at  timestamptz,
        created_at    timestamptz NOT NULL DEFAULT now(),
        revoked_at    timestamptz
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS venue_api_keys_venue_id_idx
        ON public.venue_api_keys (venue_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS venue_api_keys_active_idx
        ON public.venue_api_keys (venue_id) WHERE revoked_at IS NULL
    `;

    // 2. Webhook subscriptions
    await sql`
      CREATE TABLE IF NOT EXISTS public.venue_webhook_subscriptions (
        id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_id      uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
        api_key_id    uuid        REFERENCES public.venue_api_keys(id) ON DELETE CASCADE,
        event_type    text        NOT NULL,
        target_url    text        NOT NULL,
        source        text        NOT NULL DEFAULT 'zapier',
        active        boolean     NOT NULL DEFAULT true,
        last_fired_at timestamptz,
        fail_count    integer     NOT NULL DEFAULT 0,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS venue_webhook_subs_venue_id_idx
        ON public.venue_webhook_subscriptions (venue_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS venue_webhook_subs_event_idx
        ON public.venue_webhook_subscriptions (venue_id, event_type) WHERE active
    `;

    // 3. Event audit log
    await sql`
      CREATE TABLE IF NOT EXISTS public.venue_integration_events (
        id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_id      uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
        event_type    text        NOT NULL,
        payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
        fanout        integer     NOT NULL DEFAULT 0,
        delivered     integer     NOT NULL DEFAULT 0,
        created_at    timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS venue_integration_events_venue_id_idx
        ON public.venue_integration_events (venue_id, created_at DESC)
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({
      success: true,
      message: 'Migration 089 applied — public integrations API tables created.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-089]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
