import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import {
  getExperimentView,
  upsertVariant,
  setVariantFlags,
  deleteVariant,
  resetVariantStats,
  setPageSettings,
  listPages,
  createPage,
  normalizePageKey,
  FUNNEL_ELEMENTS,
  type ElementKey,
  type ExperimentView,
} from '@/lib/funnel-experiments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_PAGE = 'bride-booking-system';

/** Load every tracked landing page plus its live experiment view. */
async function loadAll(): Promise<{
  pages: Awaited<ReturnType<typeof listPages>>;
  views: Record<string, ExperimentView>;
}> {
  const pages = await listPages();
  const views: Record<string, ExperimentView> = {};
  const results = await Promise.all(pages.map((p) => getExperimentView(p.page_key)));
  pages.forEach((p, i) => {
    const v = results[i];
    if (v) views[p.page_key] = v;
  });
  return { pages, views };
}

export async function GET() {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { pages, views } = await loadAll();
    return NextResponse.json({ pages, views });
  } catch {
    return NextResponse.json(
      { error: 'Could not load experiments. Run db/funnel_ab_testing.sql in Supabase.' },
      { status: 500 },
    );
  }
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
    case 'add-page': {
      const key = normalizePageKey((body.newPageKey as string) ?? '');
      if (!key) {
        return NextResponse.json({ error: 'Enter a valid landing page slug.' }, { status: 400 });
      }
      ok = await createPage(key);
      break;
    }
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

  const { pages, views } = await loadAll();
  return NextResponse.json({ pages, views });
}
