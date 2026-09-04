/**
 * PDF version of the Bride Booking System™ 30-day report.
 * Rendered with @react-pdf/renderer — real flexbox, so the layout mirrors
 * the dashboard 1-for-1: funnel boxes with dashed connectors + conversion %
 * between them, equal-size KPI cards, bar charts, geography, lead insights.
 */

import React from 'react';
import path from 'path';
import {
  Document, Page, View, Text, Image, StyleSheet, renderToBuffer,
} from '@react-pdf/renderer';

const LOGO_PATH = path.join(process.cwd(), 'public', 'storyvenue-light-logo.png');
import type { BookingReportData } from '@/lib/booking-report-email';

// ── Lead value assumptions (tweak here, used by "Lead Value" & "Wedding Opportunity" sections) ──
const LEAD_REPLACEMENT_COST_PER_LEAD = 75;    // USD — cost to acquire one qualified wedding-venue inquiry independently
const NATIONAL_AVG_VENUE_RENTAL_VALUE = 7500; // USD — national average venue rental/booking value

// ── Palette (matches dashboard) ───────────────────────────────────────────────
const C = {
  ink:      '#111827',
  gray700:  '#374151',
  gray500:  '#6b7280',
  gray400:  '#9ca3af',
  gray300:  '#d1d5db',
  border:   '#e5e7eb',
  bg:       '#f9fafb',
  blue:     '#3b82f6',
  violet:   '#8b5cf6',
  indigo:   '#6366f1',
  green:    '#10b981',
  greenBg:  '#d1fae5',
  greenTx:  '#059669',
  amber:    '#f59e0b',
  pink:     '#ec4899',
};

const s = StyleSheet.create({
  page: {
    paddingTop: 36, paddingBottom: 48, paddingHorizontal: 36,
    fontFamily: 'Helvetica', fontSize: 9, color: C.gray700, backgroundColor: '#ffffff',
  },

  // Header
  header: {
    backgroundColor: '#1b1b1b', borderRadius: 12, padding: 20,
    marginBottom: 20,
  },
  headerLogoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  headerLogo: { width: 90, height: 18 },
  headerSystemName: { fontSize: 11, color: '#ffffff', marginLeft: 8 },
  headerVenue:  { fontSize: 16, color: '#ffffff', fontFamily: 'Helvetica-Bold' },
  headerDate:   { fontSize: 9, color: '#9ca3af', marginTop: 4 },

  // Section headers
  section: { marginTop: 18, marginBottom: 8, borderBottomWidth: 1.5, borderBottomColor: '#f3f4f6', paddingBottom: 5, flexDirection: 'row', alignItems: 'baseline' },
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.ink },
  sectionSub:   { fontSize: 7.5, color: C.gray400, marginLeft: 6 },

  // Funnel
  funnelRow: { flexDirection: 'row', alignItems: 'stretch' },
  funnelBox: {
    flex: 1, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingVertical: 14, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  funnelCount: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: C.ink },
  funnelLabel: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.gray500, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 4, textAlign: 'center' },
  funnelConnector: { width: 44, alignItems: 'center', justifyContent: 'center' },
  funnelDash: { width: '80%', borderTopWidth: 1.2, borderTopColor: C.gray300, borderStyle: 'dashed' },
  funnelPct: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.ink, marginTop: 4 },
  funnelPctLabel: { fontSize: 5.5, color: C.gray400, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 1 },

  // KPI cards
  kpiRow: { flexDirection: 'row', marginHorizontal: -3 },
  kpiCard: {
    flex: 1, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, padding: 10, marginHorizontal: 3,
  },
  kpiAccent: { width: 18, height: 3, borderRadius: 2, marginBottom: 6 },
  kpiValue:  { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.ink },
  kpiBadge:  { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.greenTx, marginTop: 2 },
  kpiLabel:  { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.gray400, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 4 },

  // Two-column layout
  twoCol: { flexDirection: 'row', marginHorizontal: -4 },
  col: { flex: 1, marginHorizontal: 4 },

  // Mini cards (bar chart containers)
  card: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12 },
  cardTitle: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.gray700, marginBottom: 8 },

  // Bar rows
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  barLabel: { width: 78, fontSize: 8, color: C.gray700 },
  barTrack: { flex: 1, height: 6, backgroundColor: '#eef0f3', borderRadius: 3, marginHorizontal: 6 },
  barFill: { height: 6, borderRadius: 3 },
  barValue: { width: 40, fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.ink, textAlign: 'right' },

  // Vertical bar charts (DOW / months)
  vChart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 60, marginTop: 6 },
  vBarWrap: { flex: 1, alignItems: 'center', marginHorizontal: 2 },
  vBar: { width: '70%', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  vBarLabel: { fontSize: 6, color: C.gray400, marginTop: 3 },
  vBarCount: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.gray700, marginBottom: 2 },

  footer: {
    position: 'absolute', bottom: 20, left: 36, right: 36,
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 8,
  },
  footerText: { fontSize: 7, color: C.gray400 },

  // Line-item value rows (Lead Value / Wedding Opportunity sections)
  valueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 },
  valueRowLabel: { flex: 1, paddingRight: 10, fontSize: 8.5, color: C.gray700 },
  valueRowValue: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.ink },
  valueRowValueHeadline: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  footnote: { fontSize: 7, fontStyle: 'italic', color: C.gray400, marginTop: 6, lineHeight: 1.35 },
});

function fmtNum(n: number): string { return n.toLocaleString('en-US'); }
function fmtDollars(v: number | null): string { return v ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'; }
function fmtDuration(sec: number | null): string {
  if (!sec) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60); const r = sec % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Reusable pieces ───────────────────────────────────────────────────────────

function Section({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={s.section} wrap={false}>
      <Text style={s.sectionTitle}>{title}</Text>
      {sub ? <Text style={s.sectionSub}>{sub}</Text> : null}
    </View>
  );
}

function BarRow({ label, count, max, color, suffix }: { label: string; count: number; max: number; color: string; suffix?: string }) {
  const w = max > 0 ? Math.max((count / max) * 100, count > 0 ? 3 : 0) : 0;
  return (
    <View style={s.barRow}>
      <Text style={s.barLabel}>{label.length > 20 ? label.slice(0, 19) + '…' : label}</Text>
      <View style={s.barTrack}>
        <View style={[s.barFill, { width: `${w}%`, backgroundColor: color }]} />
      </View>
      <Text style={s.barValue}>{fmtNum(count)}{suffix ?? ''}</Text>
    </View>
  );
}

function ValueRow({ label, value, headline, accent }: { label: string; value: string; headline?: boolean; accent?: string }) {
  return (
    <View style={s.valueRow}>
      <Text style={s.valueRowLabel}>{label}</Text>
      <Text style={headline ? [s.valueRowValue, s.valueRowValueHeadline, { color: accent ?? C.ink }] : s.valueRowValue}>{value}</Text>
    </View>
  );
}

function KpiCard({ label, value, accent, badge }: { label: string; value: string; accent: string; badge?: string }) {
  return (
    <View style={s.kpiCard}>
      <View style={[s.kpiAccent, { backgroundColor: accent }]} />
      <Text style={s.kpiValue}>{value}</Text>
      <Text style={s.kpiBadge}>{badge ?? ' '}</Text>
      <Text style={s.kpiLabel}>{label}</Text>
    </View>
  );
}

function VBarChart({ items, color }: { items: { label: string; count: number }[]; color: string }) {
  const max = Math.max(...items.map(i => i.count), 1);
  return (
    <View style={s.vChart}>
      {items.map((it, idx) => {
        const h = Math.max((it.count / max) * 44, it.count > 0 ? 3 : 1.5);
        return (
          <View key={idx} style={s.vBarWrap}>
            <Text style={s.vBarCount}>{it.count > 0 ? String(it.count) : ' '}</Text>
            <View style={[s.vBar, { height: h, backgroundColor: it.count > 0 ? color : C.border }]} />
            <Text style={s.vBarLabel}>{it.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function delta(cur: number, prior: number): string | undefined {
  if (!prior) return undefined;
  const p = Math.round(((cur - prior) / prior) * 100);
  return `${p >= 0 ? '+' : '-'}${Math.abs(p)}% vs prior`;
}

// ── Document ──────────────────────────────────────────────────────────────────

const SOURCE_COLOR: Record<string, string> = {
  meta: C.blue, google: C.amber, webform: C.green, direct: C.gray500, other: C.violet,
};

function ReportDoc({ d }: { d: BookingReportData }) {
  const totalSrc  = d.sources.reduce((a, r) => a + r.count, 0);
  const totalDev  = Object.values(d.devices).reduce((a, v) => a + v, 0);
  const devices   = Object.entries(d.devices).sort(([, a], [, b]) => b - a);
  const maxEngage = Math.max(d.photoViews, d.formOpens, d.formSubmits, d.faqOpens, d.mapClicks, d.socialClicks, 1);
  const maxRef    = Math.max(...d.referrers.map(r => r.count), 1);
  const maxCity   = Math.max(...d.topCities.map(r => r.count), 1);
  const maxState  = Math.max(...d.topStates.map(r => r.count), 1);
  const maxLeadSrc  = Math.max(...d.leadSources.map(r => r.count), 1);
  const maxTimeline = Math.max(...d.timelines.map(r => r.count), 1);
  const maxValue    = Math.max(...d.valueBuckets.map(r => r.count), 1);
  const maxGuest    = Math.max(...d.guestBuckets.map(r => r.count), 1);

  return (
    <Document title={`Bride Booking System Report — ${d.periodLabel}`} author="StoryVenue">
      <Page size="LETTER" style={s.page}>

        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLogoRow}>
            <Image src={LOGO_PATH} style={s.headerLogo} />
            <Text style={s.headerSystemName}>- Bride Booking System&#8482;</Text>
          </View>
          <Text style={s.headerVenue}>{d.venueName}</Text>
          <Text style={s.headerDate}>{d.periodLabel}</Text>
        </View>

        {/* Lead Value This Period */}
        <View wrap={false}>
          <Section title="Lead Value This Period" sub="What these leads would cost to generate independently" />
          <View style={s.card} wrap={false}>
            <ValueRow label="Leads delivered this period" value={fmtNum(d.totalLeads)} />
            <ValueRow
              label={`Cost to generate independently ($${LEAD_REPLACEMENT_COST_PER_LEAD}/lead)`}
              value={`$${fmtNum(d.totalLeads * LEAD_REPLACEMENT_COST_PER_LEAD)}`}
              headline
              accent={C.indigo}
            />
          </View>
        </View>
        <Text style={s.footnote}>
          Based on a $75 average cost to acquire a single qualified wedding-venue inquiry through independent marketing (ads, SEO, directories). This reflects what it would cost to generate this same volume of leads without your Bride Booking System.
        </Text>

        {/* Wedding Opportunity In Your Pipeline */}
        <View wrap={false}>
          <Section title="Wedding Opportunity In Your Pipeline" sub="Estimated wedding-spend potential of your leads this period" />
          <View style={s.card} wrap={false}>
            <ValueRow label="Leads delivered this period" value={fmtNum(d.totalLeads)} />
            <ValueRow label="Average venue rental value (national average)" value={`$${fmtNum(NATIONAL_AVG_VENUE_RENTAL_VALUE)}`} />
            <ValueRow
              label="Total opportunity represented"
              value={`$${fmtNum(d.totalLeads * NATIONAL_AVG_VENUE_RENTAL_VALUE)}`}
              headline
              accent={C.green}
            />
          </View>
        </View>
        <Text style={s.footnote}>
          Reflects the combined wedding-spend potential of the inquiries in your pipeline this period, based on $7,500, the national average venue rental value.
        </Text>

        {/* 1. Booking Funnel — boxes + dashed connectors with conversion % */}
        <View wrap={false}>
          <Section title="Booking Funnel" sub="How leads progress from inquiry to a booked wedding" />
          <View style={s.funnelRow} wrap={false}>
            {d.steps.map((step, i) => (
              <React.Fragment key={step.key}>
                {i > 0 && (
                  <View style={s.funnelConnector}>
                    <View style={s.funnelDash} />
                    <Text style={s.funnelPct}>{d.conversions[i - 1] != null ? `${d.conversions[i - 1]}%` : '—'}</Text>
                    <Text style={s.funnelPctLabel}>conversion</Text>
                  </View>
                )}
                <View style={s.funnelBox}>
                  <Text style={s.funnelCount}>{fmtNum(step.count)}</Text>
                  <Text style={s.funnelLabel}>{step.label}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>
        </View>

        {/* 2. Lead Sources */}
        <View wrap={false}>
          <Section title="Lead Sources" sub="Where your leads came from" />
          <View style={s.card} wrap={false}>
            {d.sources.filter(x => x.count > 0).length === 0 ? (
              <Text style={{ fontSize: 8, color: C.gray400 }}>No source data for this period.</Text>
            ) : (
              d.sources.filter(x => x.count > 0).sort((a, b) => b.count - a.count).map(src => (
                <BarRow key={src.key} label={src.label} count={src.count} max={totalSrc} color={SOURCE_COLOR[src.key] ?? C.violet} />
              ))
            )}
          </View>
        </View>

        {/* 3. Listing Analytics KPIs */}
        <View wrap={false}>
          <Section title="Listing Analytics" sub="Visitor & traffic metrics" />
          <View style={s.kpiRow} wrap={false}>
            <KpiCard label="Listing Views"   value={fmtNum(d.totalViews)}     accent={C.blue}   badge={delta(d.totalViews, d.priorViews)} />
            <KpiCard label="Unique Visitors" value={fmtNum(d.uniqueVisitors)} accent={C.violet} badge={delta(d.uniqueVisitors, d.priorUniqueVisitors)} />
            <KpiCard label="Form Submits"    value={fmtNum(d.formSubmits)}    accent={C.green} />
            <KpiCard label="Avg Session"     value={fmtDuration(d.avgSessionDuration)} accent={C.amber} />
          </View>
        </View>

        {/* 4. Engagement + Scroll depth */}
        <View wrap={false}>
          <Section title="Engagement Breakdown" sub="What visitors interacted with" />
          <View style={s.twoCol} wrap={false}>
            <View style={s.col}>
              <View style={s.card}>
                <Text style={s.cardTitle}>Engagement</Text>
                <BarRow label="Photo views"   count={d.photoViews}   max={maxEngage} color={C.amber} />
                <BarRow label="Form opens"    count={d.formOpens}    max={maxEngage} color={C.green} />
                <BarRow label="Form submits"  count={d.formSubmits}  max={maxEngage} color={C.blue} />
                <BarRow label="FAQ opens"     count={d.faqOpens}     max={maxEngage} color={C.violet} />
                <BarRow label="Map clicks"    count={d.mapClicks}    max={maxEngage} color={C.pink} />
                <BarRow label="Social clicks" count={d.socialClicks} max={maxEngage} color={C.gray500} />
              </View>
            </View>
            <View style={s.col}>
              <View style={s.card}>
                <Text style={s.cardTitle}>Scroll Depth</Text>
                <BarRow label="25% of page" count={d.scrollDepth.pct_25}  max={100} color={C.blue} suffix="%" />
                <BarRow label="50% of page" count={d.scrollDepth.pct_50}  max={100} color={C.blue} suffix="%" />
                <BarRow label="75% of page" count={d.scrollDepth.pct_75}  max={100} color={C.blue} suffix="%" />
                <BarRow label="Bottom"      count={d.scrollDepth.pct_100} max={100} color={C.blue} suffix="%" />
              </View>
            </View>
          </View>
        </View>

        {/* 5. Traffic sources + devices */}
        <View wrap={false}>
          <Section title="Traffic Sources & Devices" />
          <View style={s.twoCol} wrap={false}>
            <View style={s.col}>
              <View style={s.card}>
                <Text style={s.cardTitle}>Traffic Sources</Text>
                {d.referrers.length === 0
                  ? <Text style={{ fontSize: 8, color: C.gray400 }}>No data yet.</Text>
                  : d.referrers.slice(0, 6).map((r, i) => (
                      <BarRow key={i} label={r.source} count={r.count} max={maxRef} color={C.indigo} />
                    ))}
              </View>
            </View>
            <View style={s.col}>
              <View style={s.card}>
                <Text style={s.cardTitle}>Devices</Text>
                {devices.length === 0
                  ? <Text style={{ fontSize: 8, color: C.gray400 }}>No data yet.</Text>
                  : devices.map(([dev, cnt], i) => (
                      <BarRow key={i} label={dev.charAt(0).toUpperCase() + dev.slice(1)} count={cnt} max={totalDev} color={C.gray500} />
                    ))}
              </View>
            </View>
          </View>
        </View>

        {/* 6. Inquiries by day of week */}
        <View wrap={false}>
          <Section title="Inquiries by Day of Week" sub="When people send you inquiries" />
          <View style={s.card} wrap={false}>
            <VBarChart items={d.inquiryDow.map((c, i) => ({ label: DOW[i], count: c }))} color={C.blue} />
          </View>
        </View>

        {/* 7. Geography */}
        <View wrap={false}>
          <Section title="Geography" sub="Where your visitors are coming from" />
          <View style={s.twoCol} wrap={false}>
            <View style={s.col}>
              <View style={s.card}>
                <Text style={s.cardTitle}>Top Cities</Text>
                {d.topCities.length === 0
                  ? <Text style={{ fontSize: 8, color: C.gray400 }}>No data yet.</Text>
                  : d.topCities.slice(0, 5).map((r, i) => (
                      <BarRow key={i} label={`${r.city}${r.region ? `, ${r.region}` : ''}`} count={r.count} max={maxCity} color={C.ink} />
                    ))}
              </View>
            </View>
            <View style={s.col}>
              <View style={s.card}>
                <Text style={s.cardTitle}>Top States / Regions</Text>
                {d.topStates.length === 0
                  ? <Text style={{ fontSize: 8, color: C.gray400 }}>No data yet.</Text>
                  : d.topStates.slice(0, 5).map((r, i) => (
                      <BarRow key={i} label={`${r.region} · ${r.country}`} count={r.count} max={maxState} color={C.ink} />
                    ))}
              </View>
            </View>
          </View>
        </View>

        {/* 8. Lead insights */}
        <View wrap={false}>
          <Section title="Lead Insights" sub="All-time from your inquiries" />
          <View style={s.kpiRow} wrap={false}>
            <KpiCard label="Total Leads"    value={fmtNum(d.totalLeads)}         accent={C.indigo} />
            <KpiCard label="Avg Deal Value" value={fmtDollars(d.avgDealValue)}   accent={C.green} />
            <KpiCard label="Avg Guests"     value={d.avgGuestCount ? fmtNum(d.avgGuestCount) : '—'} accent={C.amber} />
          </View>
        </View>

        <View style={[s.twoCol, { marginTop: 8 }]} wrap={false}>
          <View style={s.col}>
            <View style={s.card}>
              <Text style={s.cardTitle}>How Leads Found You</Text>
              {d.leadSources.length === 0
                ? <Text style={{ fontSize: 8, color: C.gray400 }}>No data yet.</Text>
                : d.leadSources.slice(0, 6).map((r, i) => (
                    <BarRow key={i} label={r.label} count={r.count} max={maxLeadSrc} color={C.indigo} />
                  ))}
            </View>
          </View>
          <View style={s.col}>
            <View style={s.card}>
              <Text style={s.cardTitle}>Booking Timeline</Text>
              {d.timelines.length === 0
                ? <Text style={{ fontSize: 8, color: C.gray400 }}>No data yet.</Text>
                : d.timelines.slice(0, 5).map((r, i) => (
                    <BarRow key={i} label={r.label} count={r.count} max={maxTimeline} color={C.amber} />
                  ))}
            </View>
          </View>
        </View>

        <View style={[s.twoCol, { marginTop: 8 }]} wrap={false}>
          <View style={s.col}>
            <View style={s.card}>
              <Text style={s.cardTitle}>Guest Count Breakdown</Text>
              {d.guestBuckets.length === 0
                ? <Text style={{ fontSize: 8, color: C.gray400 }}>No data yet.</Text>
                : d.guestBuckets.map((r, i) => (
                    <BarRow key={i} label={r.label} count={r.count} max={maxGuest} color={C.violet} />
                  ))}
            </View>
          </View>
          <View style={s.col}>
            <View style={s.card}>
              <Text style={s.cardTitle}>Deal Value Ranges</Text>
              {d.valueBuckets.length === 0
                ? <Text style={{ fontSize: 8, color: C.gray400 }}>No data yet.</Text>
                : d.valueBuckets.map((r, i) => (
                    <BarRow key={i} label={r.label} count={r.count} max={maxValue} color={C.green} />
                  ))}
            </View>
          </View>
        </View>

        {/* 9. Wedding month popularity */}
        <View wrap={false}>
          <Section title="Wedding Month Popularity" sub="When your leads plan to get married" />
          <View style={s.card} wrap={false}>
            <VBarChart items={d.eventMonths.map(m => ({ label: m.month, count: m.count }))} color={C.blue} />
          </View>
        </View>

        {/* Footer on every page */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>StoryVenue Bride Booking System™  |  Data covers {d.fromDate} - {d.toDate}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

      </Page>
    </Document>
  );
}

/** Render the report as a PDF Buffer (for email attachment or download). */
export async function buildBookingReportPdf(d: BookingReportData): Promise<Buffer> {
  return await renderToBuffer(<ReportDoc d={d} />);
}
