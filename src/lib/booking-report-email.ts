/**
 * Builds the HTML email for the Bride Booking System™ monthly report.
 * Mirrors the dashboard 1-for-1: funnel, source breakdown, listing analytics,
 * engagement, geography, lead insights — all in a self-contained email that
 * renders cleanly in Gmail, Apple Mail, and Outlook.
 */

export interface FunnelStep   { key: string; label: string; count: number }
export interface SourceRow    { key: string; label: string; count: number }
export interface ReferrerRow  { source: string; count: number }
export interface GeoCityRow   { city: string; region: string | null; country: string | null; count: number }
export interface GeoStateRow  { region: string; country: string; count: number }
export interface GeoCountryRow{ country: string; count: number }
export interface KvRow        { label: string; count: number }
export interface MonthRow     { month: string; count: number }
export interface TimelineRow  { label: string; count: number }

export interface BookingReportData {
  venueName:    string;
  periodLabel:  string;
  fromDate:     string;
  toDate:       string;
  dashboardUrl: string;

  // ── Booking funnel ─────────────────────────────────────────────────────────
  steps:       FunnelStep[];
  conversions: (number | null)[];
  sources:     SourceRow[];

  // ── Listing analytics ──────────────────────────────────────────────────────
  totalLeads:          number;
  totalViews:          number;
  uniqueVisitors:      number;
  formSubmits:         number;
  avgSessionDuration:  number | null;
  priorViews:          number;
  priorUniqueVisitors: number;

  // ── Engagement breakdown ────────────────────────────────────────────────────
  photoViews:   number;
  formOpens:    number;
  faqOpens:     number;
  mapClicks:    number;
  socialClicks: number;

  // ── Scroll depth (% of visitors) ───────────────────────────────────────────
  scrollDepth: { pct_25: number; pct_50: number; pct_75: number; pct_100: number };

  // ── Traffic sources ─────────────────────────────────────────────────────────
  referrers: ReferrerRow[];

  // ── Devices ─────────────────────────────────────────────────────────────────
  devices: Record<string, number>;

  // ── Inquiries by day of week ─────────────────────────────────────────────────
  inquiryDow: number[];

  // ── Geography ───────────────────────────────────────────────────────────────
  topCities:    GeoCityRow[];
  topStates:    GeoStateRow[];
  topCountries: GeoCountryRow[];

  // ── Lead insights ────────────────────────────────────────────────────────────
  avgGuestCount:        number | null;
  avgDealValue:         number | null;
  guestBuckets:         KvRow[];
  leadSources:          KvRow[];
  eventMonths:          MonthRow[];
  valueBuckets:         KvRow[];
  timelines:            TimelineRow[];
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const SOURCE_COLOR: Record<string, string> = {
  meta: '#3b82f6', google: '#f59e0b', direct: '#6b7280', other: '#8b5cf6',
};

function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtNum(n: number): string { return n.toLocaleString(); }

function fmtDuration(seconds: number | null): string {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function fmtDollars(v: number | null): string {
  if (!v) return '—';
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function pct(num: number, den: number): string {
  if (!den) return '0%';
  return `${Math.round((num / den) * 100)}%`;
}

function deltaBadge(cur: number, prior: number): string {
  if (!prior) return '';
  const p = Math.round(((cur - prior) / prior) * 100);
  if (p === 0) return `<span style="display:inline-block;font-size:10px;font-weight:700;color:#6b7280;background:#f3f4f6;border-radius:20px;padding:1px 7px;margin-left:6px;">0%</span>`;
  const up = p > 0;
  return `<span style="display:inline-block;font-size:10px;font-weight:700;color:${up ? '#059669' : '#dc2626'};background:${up ? '#d1fae5' : '#fee2e2'};border-radius:20px;padding:1px 7px;margin-left:6px;">${up ? '↑' : '↓'} ${Math.abs(p)}%</span>`;
}

// ── Section helpers ────────────────────────────────────────────────────────────

function sectionHeader(title: string, sub = ''): string {
  return `
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:28px 0 14px;">
      <tr>
        <td style="border-bottom:2px solid #f3f4f6;padding-bottom:8px;">
          <span style="font-size:13px;font-weight:700;color:#111827;">${esc(title)}</span>
          ${sub ? `<span style="font-size:11px;color:#9ca3af;margin-left:6px;">${esc(sub)}</span>` : ''}
        </td>
      </tr>
    </table>`;
}

function kpiGrid(cells: string[]): string {
  const cols = Math.min(cells.length, 4);
  const w = Math.floor(100 / cols);
  return `<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
    ${cells.map(c => `<td width="${w}%" style="padding:3px;" valign="top">${c}</td>`).join('')}
  </tr></table>`;
}

function kpiCell(label: string, value: string, accent = '#8b5cf6', badge = ''): string {
  return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;">
    <tr><td style="padding:12px 10px 10px;">
      <div style="width:24px;height:3px;background:${accent};border-radius:2px;margin-bottom:8px;"></div>
      <div style="font-size:18px;font-weight:800;color:#111827;">${esc(value)}${badge}</div>
      <div style="font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#9ca3af;margin-top:3px;">${esc(label)}</div>
    </td></tr>
  </table>`;
}

function barRow(label: string, count: number, max: number, color = '#6366f1', extra = ''): string {
  const barW = max > 0 ? Math.round((count / max) * 180) : 0;
  return `<tr>
    <td style="padding:5px 0;width:110px;font-size:12px;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(label)}">${esc(label)}</td>
    <td style="padding:5px 8px;">
      <table cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="background:${color};border-radius:3px;height:8px;width:${barW}px;font-size:0;">&nbsp;</td>
      </tr></table>
    </td>
    <td align="right" style="padding:5px 0;font-size:12px;font-weight:700;color:#111827;white-space:nowrap;">${fmtNum(count)}${extra}</td>
  </tr>`;
}

// ── Main builder ───────────────────────────────────────────────────────────────

export function buildBookingReportHtml(d: BookingReportData): string {

  // ── Funnel ─────────────────────────────────────────────────────────────────
  const funnelCells = d.steps.map((step, i) => {
    const conv = d.conversions[i - 1];
    const connectorHtml = i > 0
      ? `<td align="center" width="48" style="font-size:10px;color:#6b7280;padding:0 2px;">
           ${conv != null ? `<strong style="color:#111827;">${conv}%</strong><br><span style="font-size:9px;">conv.</span>` : '<span style="color:#d1d5db;">—</span>'}
         </td>`
      : '';
    return `${connectorHtml}<td align="center" style="padding:0;">
      <table cellpadding="0" cellspacing="0" border="0" width="112" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;">
        <tr><td align="center" style="padding:16px 8px 14px;">
          <div style="font-size:24px;font-weight:800;color:#111827;">${fmtNum(step.count)}</div>
          <div style="font-size:9px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;margin-top:3px;">${esc(step.label)}</div>
        </td></tr>
      </table>
    </td>`;
  }).join('');

  // ── Sources ────────────────────────────────────────────────────────────────
  const totalSrc = d.sources.reduce((s, r) => s + r.count, 0);
  const sourceRows = d.sources.filter(s => s.count > 0).sort((a, b) => b.count - a.count)
    .map(s => barRow(s.label, s.count, totalSrc, SOURCE_COLOR[s.key] || '#8b5cf6', ` <span style="font-size:10px;font-weight:400;color:#9ca3af;">(${pct(s.count, totalSrc)})</span>`))
    .join('');

  // ── Engagement ─────────────────────────────────────────────────────────────
  const maxEngage = Math.max(d.photoViews, d.faqOpens, d.mapClicks, d.socialClicks, d.formOpens, d.formSubmits, 1);
  const engageRows = [
    ['Photo views',   d.photoViews,   '#f59e0b'],
    ['Form opens',    d.formOpens,    '#10b981'],
    ['Form submits',  d.formSubmits,  '#3b82f6'],
    ['FAQ opens',     d.faqOpens,     '#8b5cf6'],
    ['Map clicks',    d.mapClicks,    '#ec4899'],
    ['Social clicks', d.socialClicks, '#6b7280'],
  ].map(([l, c, col]) => barRow(String(l), Number(c), maxEngage, String(col))).join('');

  // ── Scroll depth ───────────────────────────────────────────────────────────
  const scrollRows = [
    ['25% of page',  d.scrollDepth.pct_25],
    ['50% of page',  d.scrollDepth.pct_50],
    ['75% of page',  d.scrollDepth.pct_75],
    ['Bottom',       d.scrollDepth.pct_100],
  ].map(([l, v]) => barRow(String(l), Number(v), 100, '#3b82f6', '%')).join('');

  // ── Traffic sources ─────────────────────────────────────────────────────────
  const maxRef = Math.max(...d.referrers.map(r => r.count), 1);
  const refRows = d.referrers.slice(0, 6)
    .map(r => barRow(r.source, r.count, maxRef, '#6366f1')).join('');

  // ── Devices ────────────────────────────────────────────────────────────────
  const totalDev = Object.values(d.devices).reduce((s, v) => s + v, 0);
  const deviceRows = Object.entries(d.devices)
    .sort(([,a],[,b]) => b - a)
    .map(([dev, cnt]) => barRow(dev.charAt(0).toUpperCase() + dev.slice(1), cnt, totalDev, '#6b7280', ` <span style="font-size:10px;color:#9ca3af;">(${pct(cnt, totalDev)})</span>`))
    .join('');

  // ── Day of week ────────────────────────────────────────────────────────────
  const maxDow = Math.max(...d.inquiryDow, 1);
  const dowCols = d.inquiryDow.map((cnt, i) => {
    const barH = maxDow > 0 ? Math.round((cnt / maxDow) * 40) : 0;
    return `<td align="center" style="padding:0 4px;vertical-align:bottom;">
      <div style="background:${cnt === maxDow && cnt > 0 ? '#3b82f6' : '#e5e7eb'};border-radius:3px 3px 0 0;height:${Math.max(barH,2)}px;width:28px;margin:0 auto;"></div>
      <div style="font-size:9px;color:#9ca3af;margin-top:3px;">${DOW_LABELS[i]}</div>
      <div style="font-size:10px;font-weight:700;color:#374151;">${cnt || ''}</div>
    </td>`;
  }).join('');

  // ── Geography ──────────────────────────────────────────────────────────────
  const maxCity = Math.max(...d.topCities.map(r => r.count), 1);
  const cityRows = d.topCities.slice(0, 5)
    .map(r => barRow(`${r.city}${r.region ? `, ${r.region}` : ''}`, r.count, maxCity, '#111827')).join('');

  const maxState = Math.max(...d.topStates.map(r => r.count), 1);
  const stateRows = d.topStates.slice(0, 5)
    .map(r => barRow(`${r.region} · ${r.country}`, r.count, maxState, '#111827')).join('');

  // ── Lead insights ──────────────────────────────────────────────────────────
  const maxSrc = Math.max(...d.leadSources.map(r => r.count), 1);
  const leadSrcRows = d.leadSources.slice(0, 6)
    .map(r => barRow(r.label, r.count, maxSrc, '#6366f1')).join('');

  const maxTimeline = Math.max(...d.timelines.map(r => r.count), 1);
  const timelineRows = d.timelines.slice(0, 5)
    .map(r => barRow(r.label.length > 18 ? r.label.slice(0, 18) + '…' : r.label, r.count, maxTimeline, '#f59e0b')).join('');

  const maxValue = Math.max(...d.valueBuckets.map(r => r.count), 1);
  const valueRows = d.valueBuckets.slice(0, 6)
    .map(r => barRow(r.label, r.count, maxValue, '#10b981')).join('');

  // ── Wedding months bar chart ────────────────────────────────────────────────
  const maxMonth = Math.max(...d.eventMonths.map(m => m.count), 1);
  const monthBars = d.eventMonths.map(m => {
    const barH = maxMonth > 0 ? Math.round((m.count / maxMonth) * 36) : 0;
    return `<td align="center" style="padding:0 2px;vertical-align:bottom;">
      <div style="background:${m.count > 0 ? '#3b82f6' : '#e5e7eb'};border-radius:2px 2px 0 0;height:${Math.max(barH, 2)}px;width:22px;margin:0 auto;"></div>
      <div style="font-size:8px;color:#9ca3af;margin-top:2px;">${m.month}</div>
    </td>`;
  }).join('');

  // ── Two-column layout helper ────────────────────────────────────────────────
  function twoCol(left: string, right: string): string {
    return `<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td width="48%" valign="top" style="padding-right:8px;">${left}</td>
      <td width="4%"></td>
      <td width="48%" valign="top" style="padding-left:8px;">${right}</td>
    </tr></table>`;
  }

  function miniCard(title: string, content: string): string {
    return `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 14px 10px;margin-bottom:8px;">
      <div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:10px;">${esc(title)}</div>
      ${content}
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Bride Booking System™ — ${esc(d.periodLabel)} Report</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f4f6;">
<tr><td align="center" style="padding:32px 16px;">
<table cellpadding="0" cellspacing="0" border="0" width="620" style="max-width:620px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

  <!-- Header -->
  <tr><td style="background:#111827;padding:28px 32px 24px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td>
        <div style="font-size:11px;font-weight:600;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px;">Bride Booking System™</div>
        <div style="font-size:22px;font-weight:800;color:#ffffff;">${esc(d.venueName)}</div>
      </td>
      <td align="right" valign="top">
        <div style="background:#1f2937;border-radius:10px;padding:8px 14px;">
          <div style="font-size:10px;font-weight:600;color:#6b7280;letter-spacing:0.05em;text-transform:uppercase;">Period</div>
          <div style="font-size:12px;font-weight:700;color:#e5e7eb;margin-top:2px;">${esc(d.periodLabel)}</div>
        </div>
      </td>
    </tr></table>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:28px 32px 32px;">

    <!-- 1. Booking Funnel -->
    ${sectionHeader('Booking Funnel', 'Leads → Conversations → Tours → Weddings')}
    <div style="overflow-x:auto;">
      <table cellpadding="0" cellspacing="0" border="0" style="min-width:100%;">
        <tr>${funnelCells}</tr>
      </table>
    </div>

    <!-- 2. Lead Sources -->
    ${sectionHeader('Lead Sources', 'Where your leads came from')}
    ${d.sources.some(s => s.count > 0) ? `<table cellpadding="0" cellspacing="0" border="0" width="100%">${sourceRows}</table>` : '<p style="font-size:12px;color:#9ca3af;margin:0;">No source data for this period.</p>'}

    <!-- 3. Listing Analytics -->
    ${sectionHeader('Listing Analytics', 'Visitor & traffic metrics')}
    ${kpiGrid([
      kpiCell('Listing Views',   fmtNum(d.totalViews),          '#3b82f6', deltaBadge(d.totalViews, d.priorViews)),
      kpiCell('Unique Visitors', fmtNum(d.uniqueVisitors),      '#8b5cf6', deltaBadge(d.uniqueVisitors, d.priorUniqueVisitors)),
      kpiCell('Form Submits',    fmtNum(d.formSubmits),         '#10b981'),
      kpiCell('Avg Session',     fmtDuration(d.avgSessionDuration), '#f59e0b'),
    ])}

    <!-- 4. Engagement + Scroll Depth (side by side) -->
    ${sectionHeader('Engagement Breakdown', 'What visitors interacted with')}
    ${twoCol(
      miniCard('Engagement', `<table cellpadding="0" cellspacing="0" border="0" width="100%">${engageRows}</table>`),
      miniCard('Scroll Depth', `<table cellpadding="0" cellspacing="0" border="0" width="100%">${scrollRows}</table>`)
    )}

    <!-- 5. Traffic Sources + Devices -->
    ${sectionHeader('Traffic Sources & Devices')}
    ${twoCol(
      miniCard('Traffic Sources', d.referrers.length ? `<table cellpadding="0" cellspacing="0" border="0" width="100%">${refRows}</table>` : '<p style="font-size:11px;color:#9ca3af;margin:0;">No data yet.</p>'),
      miniCard('Devices', Object.keys(d.devices).length ? `<table cellpadding="0" cellspacing="0" border="0" width="100%">${deviceRows}</table>` : '<p style="font-size:11px;color:#9ca3af;margin:0;">No data yet.</p>')
    )}

    <!-- 6. Inquiries by Day of Week -->
    ${sectionHeader('Inquiries by Day of Week', 'When people send you inquiries')}
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px 14px 12px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>${dowCols}</tr></table>
    </div>

    <!-- 7. Geography -->
    ${sectionHeader('Geography', 'Where your visitors are coming from')}
    ${twoCol(
      miniCard('Top Cities',  d.topCities.length  ? `<table cellpadding="0" cellspacing="0" border="0" width="100%">${cityRows}</table>` : '<p style="font-size:11px;color:#9ca3af;margin:0;">No data yet.</p>'),
      miniCard('Top States',  d.topStates.length  ? `<table cellpadding="0" cellspacing="0" border="0" width="100%">${stateRows}</table>` : '<p style="font-size:11px;color:#9ca3af;margin:0;">No data yet.</p>')
    )}

    <!-- 8. Lead Insights -->
    ${sectionHeader('Lead Insights', 'All-time from your inquiries')}
    ${kpiGrid([
      kpiCell('Total Leads',   fmtNum(d.totalLeads),         '#6366f1'),
      kpiCell('Avg Deal Value',fmtDollars(d.avgDealValue),   '#10b981'),
      kpiCell('Avg Guests',    d.avgGuestCount ? fmtNum(d.avgGuestCount) : '—', '#f59e0b'),
    ])}

    <div style="margin-top:12px;">
    ${twoCol(
      miniCard('How Leads Found You', d.leadSources.length ? `<table cellpadding="0" cellspacing="0" border="0" width="100%">${leadSrcRows}</table>` : '<p style="font-size:11px;color:#9ca3af;margin:0;">No data yet.</p>'),
      miniCard('Booking Timeline', d.timelines.length ? `<table cellpadding="0" cellspacing="0" border="0" width="100%">${timelineRows}</table>` : '<p style="font-size:11px;color:#9ca3af;margin:0;">No data yet.</p>')
    )}
    </div>

    <!-- 9. Wedding Month Popularity -->
    ${sectionHeader('Wedding Month Popularity', 'When your leads plan to get married')}
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px 14px 12px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr style="vertical-align:bottom;">${monthBars}</tr></table>
    </div>

    <!-- 10. Deal Value Ranges -->
    ${sectionHeader('Deal Value Ranges')}
    ${miniCard('Opportunity Value Breakdown', d.valueBuckets.length ? `<table cellpadding="0" cellspacing="0" border="0" width="100%">${valueRows}</table>` : '<p style="font-size:11px;color:#9ca3af;margin:0;">No data yet.</p>')}

    <!-- Divider -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;"><tr><td style="border-top:1px solid #f3f4f6;"></td></tr></table>

    <!-- CTA -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td align="center">
        <a href="${esc(d.dashboardUrl)}" style="display:inline-block;background:#111827;color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;border-radius:10px;padding:12px 28px;">
          View Full Dashboard →
        </a>
      </td>
    </tr></table>

  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:20px 32px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td style="font-size:11px;color:#9ca3af;">
        Sent by <strong style="color:#6b7280;">StoryVenue Bride Booking System™</strong><br>
        Data covers ${esc(d.fromDate)} – ${esc(d.toDate)}.
      </td>
      <td align="right" style="font-size:11px;">
        <a href="${esc(d.dashboardUrl)}" style="color:#9ca3af;text-decoration:none;">storyvenue.com</a>
      </td>
    </tr></table>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// keep old exports for backward compat (used by cron + booking-report routes)
export type { BookingReportData as default };
