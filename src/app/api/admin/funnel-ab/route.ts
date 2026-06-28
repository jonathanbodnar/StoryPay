import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import {
  getExperimentView,
  upsertVariant,
  setVariantFlags,
  deleteVariant,
  resetVariantStats,
  setPageSettings,
  FUNNEL_ELEMENTS,
  type ElementKey,
} from '@/lib/funnel-experiments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_PAGE = 'bride-booking-system';

export async function GET(request: NextRequest) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const page = request.nextUrl.searchParams.get('page') ?? DEFAULT_PAGE;
  const view = await getExperimentView(page);
  if (!view) {
    return NextResponse.json(
      { error: 'Could not load experiments. Run db/funnel_ab_testing.sql in Supabase.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ view });
}

export async function POST(request: NextRequest) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action as string | undefined;
  const page = (body.page as string | undefined) ?? DEFAULT_PAGE;

  let ok = false;
  switch (action) {
    case 'upsert': {
      const element = body.element as ElementKey;
      const content = (body.content as string)?.trim();
      if (!FUNNEL_ELEMENTS.includes(element) || !content) break;
      ok = await upsertVariant({ id: body.id as string | undefined, page_key: page, element, content });
      break;
    }
    case 'flags': {
      const id = body.id as string;
      if (!id) break;
      ok = await setVariantFlags(id, {
        enabled: body.enabled as boolean | undefined,
        pinned: body.pinned as boolean | undefined,
      });
      break;
    }
    case 'delete': {
      const id = body.id as string;
      if (!id) break;
      ok = await deleteVariant(id);
      break;
    }
    case 'reset': {
      const id = body.id as string;
      if (!id) break;
      ok = await resetVariantStats(id);
      break;
    }
    case 'settings': {
      ok = await setPageSettings(page, {
        auto_pause: body.auto_pause as boolean | undefined,
        min_impressions: body.min_impressions as number | undefined,
      });
      break;
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  if (!ok) {
    return NextResponse.json(
      { error: 'Action failed (5-variation limit reached or DB error).' },
      { status: 400 },
    );
  }

  const view = await getExperimentView(page);
  return NextResponse.json({ view });
}
