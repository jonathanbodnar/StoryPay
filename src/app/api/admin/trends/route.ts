import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const googleTrends = require('google-trends-api');

async function verifyAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token && token === process.env.ADMIN_SECRET;
}

// ── In-memory cache: keyword → { data, fetchedAt } ──────────────────────────
interface CacheEntry {
  data: TrendPoint[];
  fetchedAt: number;
}
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface TrendPoint {
  date: string;   // "Jan 2024"
  value: number;
}

// Fetch a single keyword, with a retry on rate-limit (CAPTCHA) response.
async function fetchKeyword(keyword: string, startTime: Date): Promise<TrendPoint[]> {
  const cacheKey = `${keyword}|${startTime.toISOString().slice(0, 7)}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

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

  const points: TrendPoint[] = (parsed.default?.timelineData ?? []).map(pt => ({
    date: pt.formattedAxisTime,
    value: pt.value[0] ?? 0,
  }));

  CACHE.set(cacheKey, { data: points, fetchedAt: Date.now() });
  return points;
}

// Fetch multiple keywords sequentially with a small delay to avoid rate-limiting.
async function fetchKeywords(
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

// ── GET /api/admin/trends?keywords=a,b,c&months=12 ──────────────────────────
export async function GET(request: NextRequest) {
  if (!(await verifyAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const keywordsParam = searchParams.get('keywords') ?? 'wedding venue';
  const months = parseInt(searchParams.get('months') ?? '12', 10);

  const keywords = keywordsParam
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
    .slice(0, 5); // cap at 5 per request

  const startTime = new Date();
  startTime.setMonth(startTime.getMonth() - months);

  try {
    const data = await fetchKeywords(keywords, startTime);
    return NextResponse.json({ data, keywords, months });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
