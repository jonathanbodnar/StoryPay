/**
 * Builds the HTML email for the Bride Booking System™ monthly report.
 * Mirrors the dashboard 1-for-1: funnel steps + conversion rates, source
 * breakdown, and key listing metrics — all self-contained so it renders
 * cleanly in Gmail, Apple Mail, and Outlook without external dependencies.
 */

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
}

export interface SourceRow {
  key: string;
  label: string;
  count: number;
}

export interface BookingReportData {
  venueName: string;
  periodLabel: string;   // e.g. "Jun 15 – Jul 15, 2026"
  fromDate: string;
  toDate: string;
  steps: FunnelStep[];
  conversions: (number | null)[];
  sources: SourceRow[];
  totalLeads: number;
  totalViews: number;
  formSubmits: number;
  avgSessionDuration: number | null;
  dashboardUrl: string;
}

const SOURCE_COLOR: Record<string, string> = {
  meta:   '#3b82f6',
  google: '#f59e0b',
  direct: '#6b7280',
  other:  '#8b5cf6',
};

function pct(num: number, den: number): string {
  if (!den) return '0%';
  return `${Math.round((num / den) * 100)}%`;
}

function fmtDuration(seconds: number | null): string {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export function buildBookingReportHtml(d: BookingReportData): string {
  const funnelRows = d.steps
    .map((step, i) => {
      const isLast = i === d.steps.length - 1;
      const conv   = d.conversions[i - 1];
      const convHtml = i > 0
        ? `<td align="center" width="60" style="font-size:11px;color:#6b7280;padding:0 4px;">
             ${conv != null ? `<span style="font-weight:700;color:#111827;">${conv}%</span><br><span style="font-size:10px;color:#9ca3af;">conversion</span>` : '<span style="color:#d1d5db;">—</span>'}
           </td>`
        : '';
      return `
        ${i > 0 ? convHtml : ''}
        <td align="center" style="padding:0;">
          <table cellpadding="0" cellspacing="0" border="0" width="130" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;">
            <tr><td align="center" style="padding:20px 12px 16px;">
              <div style="font-size:28px;font-weight:800;color:#111827;font-variant-numeric:tabular-nums;">${step.count.toLocaleString()}</div>
              <div style="font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;margin-top:4px;">${step.label}</div>
              ${!isLast && d.steps[i + 1]
                ? `<div style="margin-top:8px;font-size:11px;color:#9ca3af;">${pct(d.steps[i + 1].count, step.count)} convert</div>`
                : ''}
            </td></tr>
          </table>
        </td>`;
    })
    .join('');

  const totalSources = d.sources.reduce((s, r) => s + r.count, 0);
  const sourceRows = d.sources
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((s) => {
      const barWidth = totalSources > 0 ? Math.round((s.count / totalSources) * 200) : 0;
      const color = SOURCE_COLOR[s.key] || '#6b7280';
      return `
        <tr>
          <td style="padding:6px 0;width:90px;font-size:12px;font-weight:600;color:#374151;">${s.label}</td>
          <td style="padding:6px 8px;">
            <table cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="background:${color};border-radius:4px;height:10px;width:${barWidth}px;font-size:0;">&nbsp;</td>
            </tr></table>
          </td>
          <td align="right" style="padding:6px 0;font-size:12px;font-weight:700;color:#111827;white-space:nowrap;">
            ${s.count.toLocaleString()} <span style="font-size:10px;font-weight:400;color:#9ca3af;">(${pct(s.count, totalSources)})</span>
          </td>
        </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Bride Booking System™ — ${d.periodLabel} Report</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f4f6;">
    <tr><td align="center" style="padding:32px 16px;">

      <!-- Card wrapper -->
      <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header band -->
        <tr>
          <td style="background:#111827;padding:28px 32px 24px;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td>
                  <div style="font-size:13px;font-weight:600;color:#9ca3af;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px;">Bride Booking System™</div>
                  <div style="font-size:22px;font-weight:800;color:#ffffff;">${escHtml(d.venueName)}</div>
                </td>
                <td align="right" valign="top">
                  <div style="background:#1f2937;border-radius:10px;padding:8px 14px;display:inline-block;">
                    <div style="font-size:10px;font-weight:600;color:#6b7280;letter-spacing:0.05em;text-transform:uppercase;">Period</div>
                    <div style="font-size:13px;font-weight:700;color:#e5e7eb;margin-top:2px;">${escHtml(d.periodLabel)}</div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr><td style="padding:32px;">

          <!-- Booking Funnel -->
          <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:4px;">Booking Funnel</div>
          <div style="font-size:12px;color:#9ca3af;margin-bottom:20px;">How leads progressed from inquiry to booked wedding</div>

          <div style="overflow-x:auto;">
            <table cellpadding="0" cellspacing="0" border="0" style="min-width:100%;">
              <tr>${funnelRows}</tr>
            </table>
          </div>

          <!-- Divider -->
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:28px 0 24px;">
            <tr><td style="border-top:1px solid #f3f4f6;"></td></tr>
          </table>

          <!-- Lead sources -->
          <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:4px;">Lead Sources</div>
          <div style="font-size:12px;color:#9ca3af;margin-bottom:16px;">Where your leads came from this period</div>
          ${d.sources.some((s) => s.count > 0) ? `
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            ${sourceRows}
          </table>` : `<p style="font-size:12px;color:#9ca3af;margin:0;">No source data for this period.</p>`}

          <!-- Divider -->
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:28px 0 24px;">
            <tr><td style="border-top:1px solid #f3f4f6;"></td></tr>
          </table>

          <!-- KPI row -->
          <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:16px;">Key Metrics</div>
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              ${kpiCell('Listing Views',    d.totalViews.toLocaleString(),    '#3b82f6')}
              ${kpiCell('Form Submits',     d.formSubmits.toLocaleString(),   '#10b981')}
              ${kpiCell('Total Leads',      d.totalLeads.toLocaleString(),    '#8b5cf6')}
              ${kpiCell('Avg Session',      fmtDuration(d.avgSessionDuration), '#f59e0b')}
            </tr>
          </table>

          <!-- Divider -->
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:28px 0 24px;">
            <tr><td style="border-top:1px solid #f3f4f6;"></td></tr>
          </table>

          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td align="center">
                <a href="${escHtml(d.dashboardUrl)}"
                   style="display:inline-block;background:#111827;color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;border-radius:10px;padding:12px 28px;">
                  View Full Dashboard →
                </a>
              </td>
            </tr>
          </table>

        </td></tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:20px 32px;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-size:11px;color:#9ca3af;">
                  This report was sent by <strong style="color:#6b7280;">StoryVenue Bride Booking System™</strong><br>
                  Data covers ${escHtml(d.fromDate)} – ${escHtml(d.toDate)}.
                </td>
                <td align="right" style="font-size:11px;color:#d1d5db;">
                  <a href="${escHtml(d.dashboardUrl)}" style="color:#9ca3af;text-decoration:none;">storyvenue.com</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function kpiCell(label: string, value: string, accent: string): string {
  return `
    <td align="center" style="padding:4px;">
      <table cellpadding="0" cellspacing="0" border="0" width="120" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;">
        <tr><td align="center" style="padding:14px 8px 12px;">
          <div style="width:28px;height:3px;background:${accent};border-radius:2px;margin:0 auto 8px;"></div>
          <div style="font-size:20px;font-weight:800;color:#111827;">${escHtml(value)}</div>
          <div style="font-size:10px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#9ca3af;margin-top:4px;">${escHtml(label)}</div>
        </td></tr>
      </table>
    </td>`;
}

function escHtml(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
