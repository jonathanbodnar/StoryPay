/**
 * Monthly analytics digest — builds metrics for one venue over the past 30 days
 * vs the prior 30 days, then renders and sends an HTML email via Resend.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';

const DIRECTORY_SITE =
  process.env.NEXT_PUBLIC_DIRECTORY_URL ||
  process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL ||
  'https://storyvenue.com';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DigestMetrics = {
  venueId: string;
  venueName: string;
  venueSlug: string;
  email: string;
  views: number;
  uniqueVisitors: number;
  formSubmits: number;
  conversionRate: number;
  priorViews: number;
  priorUniqueVisitors: number;
  priorFormSubmits: number;
  topPhotoUrl: string | null;
  topPhotoViews: number;
  totalPhotos: number;
  avgSessionDuration: number;
  scrollPct50: number;
  leadsCreated: number;
};

// ── Metrics builder ───────────────────────────────────────────────────────────

export async function buildDigestMetrics(venueId: string): Promise<DigestMetrics | null> {
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, slug, email, gallery_images')
    .eq('id', venueId)
    .maybeSingle();

  if (!venue?.email) return null;

  const now = Date.now();
  const since30d = new Date(now - 30 * 86400000).toISOString();
  const since60d = new Date(now - 60 * 86400000).toISOString();

  const { data: current } = await supabaseAdmin
    .from('listing_events')
    .select('session_id, event_type, event_data, created_at')
    .eq('venue_id', venueId)
    .gte('created_at', since30d);

  const { data: prior } = await supabaseAdmin
    .from('listing_events')
    .select('session_id, event_type, created_at')
    .eq('venue_id', venueId)
    .gte('created_at', since60d)
    .lt('created_at', since30d);

  const { data: newLeads } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('venue_id', venueId)
    .gte('created_at', since30d);

  const rows = current ?? [];
  const priorRows = prior ?? [];

  const pageViews = rows.filter(r => r.event_type === 'page_view');
  const uniqueVisitors = new Set(pageViews.map(r => r.session_id)).size;
  const formSubmits = new Set(rows.filter(r => r.event_type === 'contact_form_submit').map(r => r.session_id)).size;
  const conversionRate = uniqueVisitors ? Math.round((formSubmits / uniqueVisitors) * 1000) / 10 : 0;

  const priorViews = priorRows.filter(r => r.event_type === 'page_view').length;
  const priorVisitors = new Set(priorRows.filter(r => r.event_type === 'page_view').map(r => r.session_id)).size;
  const priorSubmits = new Set(priorRows.filter(r => r.event_type === 'contact_form_submit').map(r => r.session_id)).size;

  // Session duration
  const sessionTimes: Record<string, { first: number; last: number }> = {};
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (!sessionTimes[r.session_id]) sessionTimes[r.session_id] = { first: t, last: t };
    else { sessionTimes[r.session_id].first = Math.min(t, sessionTimes[r.session_id].first); sessionTimes[r.session_id].last = Math.max(t, sessionTimes[r.session_id].last); }
  }
  const durations = Object.values(sessionTimes).map(s => (s.last - s.first) / 1000).filter(d => d > 0 && d < 3600);
  const avgSessionDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  // Scroll 50% reach
  const scrollSessions = new Set(rows.filter(r => r.event_type === 'scroll_50').map(r => r.session_id)).size;
  const scrollPct50 = uniqueVisitors ? Math.round((scrollSessions / uniqueVisitors) * 100) : 0;

  // Top photo
  const photoMap: Record<number, number> = {};
  for (const r of rows.filter(r => r.event_type === 'photo_view')) {
    const idx = (r.event_data as { photo_index?: number })?.photo_index ?? 0;
    photoMap[idx] = (photoMap[idx] ?? 0) + 1;
  }
  const topPhotoEntry = Object.entries(photoMap).sort(([, a], [, b]) => b - a)[0];
  const topPhotoIndex = topPhotoEntry ? Number(topPhotoEntry[0]) : null;
  const topPhotoViews = topPhotoEntry ? topPhotoEntry[1] : 0;
  const gallery = Array.isArray((venue as Record<string,unknown>).gallery_images)
    ? (venue as Record<string,unknown>).gallery_images as string[]
    : [];
  const topPhotoUrl = topPhotoIndex != null ? (gallery[topPhotoIndex] ?? null) : (gallery[0] ?? null);

  return {
    venueId: venue.id as string,
    venueName: String((venue as Record<string,unknown>).name ?? ''),
    venueSlug: String((venue as Record<string,unknown>).slug ?? ''),
    email: String((venue as Record<string,unknown>).email ?? ''),
    views: pageViews.length,
    uniqueVisitors,
    formSubmits,
    conversionRate,
    priorViews,
    priorUniqueVisitors: priorVisitors,
    priorFormSubmits: priorSubmits,
    topPhotoUrl,
    topPhotoViews,
    totalPhotos: gallery.length,
    avgSessionDuration,
    scrollPct50,
    leadsCreated: (newLeads ?? []).length,
  };
}

// ── Smart tip generator ───────────────────────────────────────────────────────

function smartTip(m: DigestMetrics): string {
  if (m.views === 0) return 'Share your listing link on Instagram, Facebook, or your email signature to start getting views.';
  if (m.scrollPct50 < 30 && m.views > 5) return `Only ${m.scrollPct50}% of visitors scroll past halfway. Try moving your best photos or your pricing higher on the page.`;
  if (m.formSubmits === 0 && m.views >= 10) return 'You\'re getting views but no inquiries yet. Make sure your contact form is visible and your listing description answers the most common questions couples have.';
  if (m.conversionRate > 0 && m.formSubmits < 3) return `Your ${m.conversionRate}% conversion rate is solid — you just need more traffic. Try sharing your listing on wedding forums or Facebook groups in your area.`;
  if (m.totalPhotos < 8) return `Venues with 15+ photos get 3× more inquiries. You have ${m.totalPhotos} — consider uploading more to stand out.`;
  if (m.avgSessionDuration > 120) return 'Visitors are spending over 2 minutes on your listing — that\'s a great sign. Make sure your contact form is easy to find at the bottom of the page.';
  return 'Keep your listing fresh — update your availability notes or add a new FAQ to signal activity to potential clients.';
}

// ── Delta helper ──────────────────────────────────────────────────────────────

function deltaArrow(current: number, prior: number): string {
  if (!prior) return '';
  const pct = Math.round(((current - prior) / prior) * 100);
  if (pct === 0) return '';
  return pct > 0 ? `↑ ${pct}%` : `↓ ${Math.abs(pct)}%`;
}

function fmtDuration(seconds: number): string {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// ── Email HTML builder ────────────────────────────────────────────────────────

export function buildDigestHtml(m: DigestMetrics): string {
  const listingUrl = `${DIRECTORY_SITE.replace(/\/$/, '')}/venue/${m.venueSlug}`;
  const dashboardUrl = `${APP_URL}/dashboard/listing/analytics`;
  const monthStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const tip = smartTip(m);

  const stat = (label: string, value: string | number, delta?: string) => `
    <td style="text-align:center;padding:16px 12px;background:#ffffff;border-radius:12px;">
      <div style="font-size:28px;font-weight:700;color:#111827;line-height:1;">${value}</div>
      ${delta ? `<div style="font-size:11px;font-weight:600;color:${delta.startsWith('↑') ? '#059669' : '#dc2626'};margin-top:4px;">${delta}</div>` : '<div style="height:20px;"></div>'}
      <div style="font-size:11px;color:#9ca3af;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em;">${label}</div>
    </td>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- Header -->
  <tr><td style="background:#111827;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">
    <div style="font-size:13px;font-weight:600;color:#9ca3af;letter-spacing:0.1em;text-transform:uppercase;">StoryVenue</div>
    <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:6px;">Your monthly listing report</div>
    <div style="font-size:13px;color:#6b7280;margin-top:4px;">Month ending ${monthStr}</div>
  </td></tr>

  <!-- Venue name -->
  <tr><td style="background:#ffffff;padding:20px 32px 0;text-align:center;">
    <div style="font-size:15px;font-weight:600;color:#374151;">${m.venueName}</div>
  </td></tr>

  <!-- Stats grid -->
  <tr><td style="background:#ffffff;padding:20px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr style="border-collapse:separate;border-spacing:8px;">
        ${stat('Listing views', m.views, deltaArrow(m.views, m.priorViews))}
        ${stat('Unique visitors', m.uniqueVisitors, deltaArrow(m.uniqueVisitors, m.priorUniqueVisitors))}
        ${stat('Inquiries sent', m.formSubmits, deltaArrow(m.formSubmits, m.priorFormSubmits))}
        ${stat('Leads created', m.leadsCreated)}
      </tr>
    </table>
  </td></tr>

  <!-- Secondary stats -->
  <tr><td style="background:#ffffff;padding:0 32px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:12px;padding:16px;">
      <tr>
        <td style="text-align:center;padding:8px 16px;">
          <div style="font-size:18px;font-weight:700;color:#111827;">${m.conversionRate}%</div>
          <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">Conversion rate</div>
        </td>
        <td style="text-align:center;padding:8px 16px;border-left:1px solid #e5e7eb;">
          <div style="font-size:18px;font-weight:700;color:#111827;">${m.scrollPct50}%</div>
          <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">Read past halfway</div>
        </td>
        <td style="text-align:center;padding:8px 16px;border-left:1px solid #e5e7eb;">
          <div style="font-size:18px;font-weight:700;color:#111827;">${fmtDuration(m.avgSessionDuration)}</div>
          <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">Avg time on listing</div>
        </td>
      </tr>
    </table>
  </td></tr>

  ${m.topPhotoUrl ? `
  <!-- Top photo -->
  <tr><td style="background:#ffffff;padding:0 32px 24px;">
    <div style="font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">
      🏆 Most viewed photo this month (${m.topPhotoViews} views)
    </div>
    <img src="${m.topPhotoUrl}" alt="Top photo" width="100%" style="border-radius:12px;object-fit:cover;max-height:220px;display:block;" />
  </td></tr>` : ''}

  <!-- Smart tip -->
  <tr><td style="background:#ffffff;padding:0 32px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px 20px;">
      <tr>
        <td>
          <div style="font-size:12px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">💡 This month's tip</div>
          <div style="font-size:14px;color:#1e3a5f;line-height:1.6;">${tip}</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- CTAs -->
  <tr><td style="background:#ffffff;padding:0 32px 32px;text-align:center;">
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
      <tr>
        <td style="padding-right:8px;">
          <a href="${dashboardUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:12px 24px;border-radius:10px;">View full analytics →</a>
        </td>
        <td>
          <a href="${listingUrl}" style="display:inline-block;background:#f9fafb;border:1px solid #e5e7eb;color:#374151;text-decoration:none;font-size:13px;font-weight:600;padding:12px 24px;border-radius:10px;">View listing</a>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f3f4f6;border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;">
    <div style="font-size:11px;color:#9ca3af;line-height:1.6;">
      You're receiving this because you have a listing on StoryVenue.<br>
      <a href="${dashboardUrl}" style="color:#6b7280;text-decoration:underline;">Manage notification preferences</a>
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Send for a single venue ───────────────────────────────────────────────────

export async function sendAnalyticsDigest(venueId: string): Promise<{ ok: boolean; reason?: string }> {
  const metrics = await buildDigestMetrics(venueId);
  if (!metrics) return { ok: false, reason: 'no_email' };

  const html = buildDigestHtml(metrics);
  const monthStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const subject = metrics.views > 0
    ? `Your listing had ${metrics.views} view${metrics.views !== 1 ? 's' : ''} this month — ${monthStr}`
    : `Your monthly StoryVenue report — ${monthStr}`;

  const result = await sendEmail({
    to: metrics.email,
    subject,
    html,
    from: { name: 'StoryVenue Analytics' },
  });

  return { ok: result.success, reason: result.error };
}

// ── Batch: all venues with published listings ─────────────────────────────────

export async function runAnalyticsDigestForAllVenues(): Promise<{ sent: number; skipped: number; errors: number }> {
  const { data: venues } = await supabaseAdmin
    .from('venues')
    .select('id')
    .eq('is_published', true)
    .not('email', 'is', null);

  let sent = 0, skipped = 0, errors = 0;

  for (const v of venues ?? []) {
    try {
      const result = await sendAnalyticsDigest(v.id as string);
      if (result.ok) sent++;
      else if (result.reason === 'no_email') skipped++;
      else errors++;
    } catch {
      errors++;
    }
  }

  return { sent, skipped, errors };
}
