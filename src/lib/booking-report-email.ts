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

// ── Helpers ────────────────────────────────────────────────────────────────────

function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtNum(n: number): string { return n.toLocaleString(); }

// ── Short summary email (full report ships as the attached PDF) ───────────────
//
// Kept intentionally small and single-column so Gmail mobile can't clip,
// collapse, or reflow it. Headline numbers only — details live in the PDF.

export function buildBookingReportSummaryHtml(d: BookingReportData): string {
  const stat = (value: string, label: string) => `
    <td width="25%" align="center" style="padding:14px 4px;">
      <div style="font-size:22px;font-weight:800;color:#111827;">${esc(value)}</div>
      <div style="font-size:9px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#9ca3af;margin-top:4px;">${esc(label)}</div>
    </td>`;

  const leads    = d.steps.find(x => x.key === 'leads')?.count ?? 0;
  const tours    = d.steps.find(x => x.key === 'tours')?.count ?? 0;
  const weddings = d.steps.find(x => x.key === 'weddings')?.count ?? 0;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bride Booking System™ Report</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f4f6;">
<tr><td align="center" style="padding:32px 16px;">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden;">

  <tr><td style="background:#111827;padding:26px 28px;">
    <div style="font-size:11px;font-weight:600;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px;">Bride Booking System™</div>
    <div style="font-size:20px;font-weight:800;color:#ffffff;">${esc(d.venueName)}</div>
    <div style="font-size:12px;color:#9ca3af;margin-top:6px;">${esc(d.periodLabel)}</div>
  </td></tr>

  <tr><td style="padding:26px 28px 8px;">
    <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#111827;">Your 30-day report is ready</p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
      Here are your headline numbers. The complete report — funnel, sources, listing analytics,
      engagement, geography, and lead insights — is attached as a PDF.
    </p>
  </td></tr>

  <tr><td style="padding:16px 28px 8px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;">
      <tr>
        ${stat(fmtNum(leads), 'Leads')}
        ${stat(fmtNum(tours), 'Tours')}
        ${stat(fmtNum(weddings), 'Weddings')}
        ${stat(fmtNum(d.totalViews), 'Views')}
      </tr>
    </table>
  </td></tr>

  <tr><td align="center" style="padding:20px 28px 8px;">
    <div style="display:inline-block;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:10px 18px;font-size:12px;color:#6d28d9;font-weight:600;">
      📎 Full report attached as PDF
    </div>
  </td></tr>

  <tr><td align="center" style="padding:16px 28px 28px;">
    <a href="${esc(d.dashboardUrl)}" style="display:inline-block;background:#111827;color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;border-radius:10px;padding:12px 28px;">
      View Live Dashboard →
    </a>
  </td></tr>

  <tr><td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:18px 28px;">
    <div style="font-size:11px;color:#9ca3af;">
      Sent by <strong style="color:#6b7280;">StoryVenue Bride Booking System™</strong> ·
      Data covers ${esc(d.fromDate)} – ${esc(d.toDate)}
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
