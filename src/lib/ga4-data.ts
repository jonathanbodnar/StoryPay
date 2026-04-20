import { BetaAnalyticsDataClient } from '@google-analytics/data';

export type Ga4DailyRow = {
  date: string;
  sessions: number;
  activeUsers: number;
};

export type Ga4ReportSuccess = {
  ok: true;
  days: number;
  totals: {
    sessions: number;
    activeUsers: number;
    newUsers: number;
    eventCount: number;
  };
  daily: Ga4DailyRow[];
};

export type Ga4ReportFailure = {
  ok: false;
  code:
    | 'missing_credentials'
    | 'missing_property_id'
    | 'permission_denied'
    | 'invalid_property'
    | 'api_error';
  message: string;
};

export type Ga4ReportResult = Ga4ReportSuccess | Ga4ReportFailure;

let cachedClient: BetaAnalyticsDataClient | null | undefined;

function getClient(): BetaAnalyticsDataClient | null {
  if (cachedClient !== undefined) return cachedClient;
  const raw = process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON;
  if (!raw || typeof raw !== 'string' || raw.trim() === '') {
    cachedClient = null;
    return null;
  }
  try {
    const credentials = JSON.parse(raw) as Record<string, unknown>;
    cachedClient = new BetaAnalyticsDataClient({ credentials });
    return cachedClient;
  } catch (e) {
    console.error('[ga4-data] invalid GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON', e);
    cachedClient = null;
    return null;
  }
}

function parseIntMetric(v: string | null | undefined): number {
  if (v == null || v === '') return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fetches GA4 overview for a property. Optionally filters pagePath to the public listing path when slug is set.
 */
export async function fetchListingGa4Report(params: {
  propertyId: string;
  listingSlug: string | null;
  days: number;
}): Promise<Ga4ReportResult> {
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      code: 'missing_credentials',
      message:
        'In-dashboard Google Analytics is not enabled on this server yet. Contact support or configure GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON.',
    };
  }

  const pid = params.propertyId.trim();
  if (!/^\d{6,15}$/.test(pid)) {
    return { ok: false, code: 'invalid_property', message: 'Invalid GA4 property ID format.' };
  }

  const days = Math.min(90, Math.max(7, Math.floor(params.days || 28)));
  const startDate = `${days}daysAgo`;
  const property = `properties/${pid}`;

  const pathSuffix = params.listingSlug ? `/venue/${params.listingSlug}` : null;

  const dimensionFilter =
    pathSuffix != null
      ? {
          filter: {
            fieldName: 'pagePath',
            stringFilter: { matchType: 'CONTAINS' as const, value: pathSuffix },
          },
        }
      : undefined;

  try {
    const [totalsResp] = await client.runReport({
      property,
      dateRanges: [{ startDate, endDate: 'today' }],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'eventCount' },
      ],
      dimensionFilter,
    });

    const [dailyResp] = await client.runReport({
      property,
      dateRanges: [{ startDate, endDate: 'today' }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
      orderBys: [{ desc: false, dimension: { dimensionName: 'date' } }],
      dimensionFilter,
    });

    const tr = totalsResp.rows?.[0];
    const totals = {
      sessions: parseIntMetric(tr?.metricValues?.[0]?.value),
      activeUsers: parseIntMetric(tr?.metricValues?.[1]?.value),
      newUsers: parseIntMetric(tr?.metricValues?.[2]?.value),
      eventCount: parseIntMetric(tr?.metricValues?.[3]?.value),
    };

    const daily: Ga4DailyRow[] = [];
    for (const row of dailyResp.rows ?? []) {
      const d = row.dimensionValues?.[0]?.value ?? '';
      daily.push({
        date: d,
        sessions: parseIntMetric(row.metricValues?.[0]?.value),
        activeUsers: parseIntMetric(row.metricValues?.[1]?.value),
      });
    }

    return { ok: true, days, totals, daily };
  } catch (e: unknown) {
    const grpc = e as { code?: number; message?: string };
    const msg = grpc.message ?? String(e);
    const denied =
      grpc.code === 7 ||
      /PERMISSION_DENIED|permission denied|7:/i.test(msg);
    const code = denied ? 'permission_denied' : 'api_error';
    if (code === 'permission_denied') {
      return {
        ok: false,
        code: 'permission_denied',
        message:
          'Google Analytics denied access. Add the StoryVenue service account as a Viewer on this GA4 property, or verify the Property ID.',
      };
    }
    console.error('[ga4-data] runReport', msg);
    return { ok: false, code: 'api_error', message: msg || 'Google Analytics API error.' };
  }
}

export function isGa4DataApiConfigured(): boolean {
  return getClient() != null;
}
