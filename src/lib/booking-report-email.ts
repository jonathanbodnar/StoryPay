/**
 * Builds the HTML email for the Bride Booking System™ monthly report.
 * Mirrors the dashboard 1-for-1: funnel, source breakdown, listing analytics,
 * engagement, geography, lead insights — all in a self-contained email that
 * renders cleanly in Gmail, Apple Mail, and Outlook.
 */

import { buildSystemEmail } from '@/lib/email-templates';

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

  const bodyHtml = `
    <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#111827;text-align:center;">${esc(d.venueName)}</p>
    <p style="margin:0 0 20px;font-size:12px;color:#9ca3af;text-align:center;text-transform:uppercase;letter-spacing:0.05em;">Bride Booking System&#8482; &middot; ${esc(d.periodLabel)}</p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#6b7280;text-align:center;">
      Here are your headline numbers. The complete report (funnel, sources, listing analytics,
      engagement, geography, and lead insights) is attached as a PDF.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;">
      <tr>
        ${stat(fmtNum(leads), 'Leads')}
        ${stat(fmtNum(tours), 'Tours')}
        ${stat(fmtNum(weddings), 'Weddings')}
        ${stat(fmtNum(d.totalViews), 'Views')}
      </tr>
    </table>`;

  return buildSystemEmail({
    title:     'Bride Booking System™ Report',
    preheader: `Your 30-day report for ${esc(d.venueName)} is ready.`,
    heading:   'Your 30-day report is ready',
    bodyHtml,
    cta:       { label: 'View live dashboard', url: d.dashboardUrl },
    footerHtml: `<p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;line-height:1.6;">Sent by <strong style="color:#6b7280;">StoryVenue Bride Booking System&#8482;</strong><br>Data covers ${esc(d.fromDate)} - ${esc(d.toDate)}</p>`,
  });
}
