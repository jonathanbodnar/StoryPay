import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const googleTrends = require('google-trends-api');

async function verifyAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token && token === process.env.ADMIN_SECRET;
}

export interface TrendPoint {
  date: string;   // "Jan 2024"
  value: number;
}

const STALE_HOURS = 24; // Re-fetch from Google after 24 h

// ── DB helpers ───────────────────────────────────────────────────────────────

async function dbGet(key: string): Promise<{ data: Record<string, TrendPoint[]>; updatedAt: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('admin_kv_cache')
    .select('value, updated_at')
    .eq('key', key)
    .maybeSingle();
  if (error || !data) return null;
  return {
    data: (data as { value: Record<string, TrendPoint[]>; updated_at: string }).value,
    updatedAt: (data as { value: Record<string, TrendPoint[]>; updated_at: string }).updated_at,
  };
}

async function dbSet(key: string, value: Record<string, TrendPoint[]>): Promise<void> {
  await supabaseAdmin
    .from('admin_kv_cache')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

// ── Google fetch ─────────────────────────────────────────────────────────────

async function fetchKeyword(keyword: string, startTime: Date): Promise<TrendPoint[]> {
  const raw: string = await googleTrends.interestOverTime({
    keyword,
    startTime,
    geo: 'US',
    hl: 'en-US',
  });

  let parsed: { default?: { timelineData?: Array<{ formattedAxisTime: string; value: number[] }> } };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Google Trends returned non-JSON for "${keyword}"`);
  }

  return (parsed.default?.timelineData ?? []).map(pt => ({
    date: pt.formattedAxisTime,
    value: pt.value[0] ?? 0,
  }));
}

async function fetchFromGoogle(
  keywords: string[],
  startTime: Date,
): Promise<Record<string, TrendPoint[]>> {
  const result: Record<string, TrendPoint[]> = {};
  for (const kw of keywords) {
    try {
      result[kw] = await fetchKeyword(kw, startTime);
    } catch {
      result[kw] = [];
    }
    if (keywords.indexOf(kw) < keywords.length - 1) {
      await new Promise(r => setTimeout(r, 800));
    }
  }
  return result;
}

// ── GET /api/admin/trends?keywords=a,b,c&months=12[&refresh=1] ──────────────
export async function GET(request: NextRequest) {
  if (!(await verifyAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const keywordsParam = searchParams.get('keywords') ?? 'wedding venue';
  const months       = parseInt(searchParams.get('months') ?? '12', 10);
  const forceRefresh = searchParams.get('refresh') === '1';

  const keywords = keywordsParam
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
    .slice(0, 5);

  const cacheKey = `trends|${keywords.join(',')}|${months}`;

  const startTime = new Date();
  startTime.setMonth(startTime.getMonth() - months);

  // 1. Try DB cache first ─────────────────────────────────────────────────────
  const cached = await dbGet(cacheKey);

  if (cached && !forceRefresh) {
    const ageHours = (Date.now() - new Date(cached.updatedAt).getTime()) / 3_600_000;

    // If stale (> 24 h), kick off a background refresh so next visit gets fresh data.
    if (ageHours >= STALE_HOURS) {
      void fetchFromGoogle(keywords, startTime).then(data => dbSet(cacheKey, data)).catch(() => {/* best-effort */});
    }

    // Always return cached data immediately (stale-while-revalidate).
    return NextResponse.json({ data: cached.data, keywords, months, cachedAt: cached.updatedAt });
  }

  // 2. No cache OR forced refresh — fetch from Google synchronously ──────────
  try {
    const data = await fetchFromGoogle(keywords, startTime);
    const now  = new Date().toISOString();
    void dbSet(cacheKey, data); // persist; fire-and-forget is fine
    return NextResponse.json({ data, keywords, months, cachedAt: now });
  } catch (err) {
    // If fetch fails but we have stale cache, return it rather than erroring.
    if (cached) {
      return NextResponse.json({ data: cached.data, keywords, months, cachedAt: cached.updatedAt, stale: true });
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
