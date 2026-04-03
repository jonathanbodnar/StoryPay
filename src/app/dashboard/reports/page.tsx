'use client';

import { useState, useCallback } from 'react';
import {
  DollarSign, FileText, Users, Clock, CreditCard, RotateCcw,
  Download, FileSpreadsheet, Table2, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';
import DateRangePicker, { DateRange, PRESETS } from '@/components/DateRangePicker';
import { classNames } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

type ReportType = 'revenue' | 'proposals' | 'customers' | 'aging' | 'payment-methods' | 'refunds';
type Format = 'csv' | 'excel' | 'pdf';

interface ReportDef {
  type: ReportType;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  bg: string;
}

interface ReportData {
  rows: Record<string, string | number>[];
  summary: Record<string, string | number>;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const REPORTS: ReportDef[] = [
  {
    type: 'revenue',
    label: 'Revenue Report',
    description: 'All paid transactions with customer details, amounts, and payment types. Perfect for bookkeeping and reconciliation.',
    icon: DollarSign,
    color: '#10b981',
    bg: 'bg-emerald-50',
  },
  {
    type: 'proposals',
    label: 'Proposals Report',
    description: 'Complete proposal history including status, amounts, and dates. Useful for pipeline analysis and sales tracking.',
    icon: FileText,
    color: '#3b82f6',
    bg: 'bg-blue-50',
  },
  {
    type: 'customers',
    label: 'Customer Summary',
    description: 'Unique customers ranked by total spend with proposal counts and last activity. Great for identifying top clients.',
    icon: Users,
    color: '#8b5cf6',
    bg: 'bg-violet-50',
  },
  {
    type: 'aging',
    label: 'Accounts Receivable Aging',
    description: 'Outstanding unpaid proposals grouped by how long they\'ve been open. Essential for following up on overdue payments.',
    icon: Clock,
    color: '#f59e0b',
    bg: 'bg-amber-50',
  },
  {
    type: 'payment-methods',
    label: 'Payment Method Breakdown',
    description: 'Conversion rates and revenue by payment type (full, installment, subscription). Useful for optimizing your payment offerings.',
    icon: CreditCard,
    color: '#293745',
    bg: 'bg-slate-50',
  },
  {
    type: 'refunds',
    label: 'Refunds Report',
    description: 'All refunded transactions with original amounts and dates. Required for accurate accounting and reconciliation.',
    icon: RotateCcw,
    color: '#ef4444',
    bg: 'bg-red-50',
  },
];

function getDefaultRange(): DateRange {
  const preset = PRESETS.find(p => p.label === 'Year to date')!;
  return { ...preset.getRange(), label: preset.label };
}

// ─── Download helpers (client-side) ──────────────────────────────────────────

async function downloadCSV(data: ReportData, label: string) {
  if (!data.rows.length) return;
  const headers = Object.keys(data.rows[0]);
  const lines = [
    headers.join(','),
    ...data.rows.map(row =>
      headers.map(h => {
        const val = String(row[h] ?? '');
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  triggerDownload(blob, `${label.replace(/\s+/g, '_')}.csv`);
}

async function downloadExcel(data: ReportData, label: string) {
  if (!data.rows.length) return;
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(data.rows);

  // Bold header row
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'E2E8F0' } } };
  }

  // Summary sheet
  const summaryRows = Object.entries(data.summary).map(([k, v]) => ({ Metric: k, Value: v }));
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  if (summaryRows.length) XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  XLSX.writeFile(wb, `${label.replace(/\s+/g, '_')}.xlsx`);
}

async function downloadPDF(data: ReportData, label: string, dateRange: DateRange) {
  if (!data.rows.length) return;
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Header
  doc.setFillColor(41, 55, 69);
  doc.rect(0, 0, 297, 18, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('StoryPay', 14, 11);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(label, 60, 11);
  doc.setFontSize(8);
  doc.text(`${dateRange.label}  |  ${dateRange.from} – ${dateRange.to}`, 170, 11);

  // Summary box
  if (Object.keys(data.summary).length) {
    let x = 14;
    const summaryY = 24;
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(8);
    for (const [k, v] of Object.entries(data.summary)) {
      doc.setFont('helvetica', 'bold');
      doc.text(String(v), x, summaryY);
      doc.setFont('helvetica', 'normal');
      doc.text(k, x, summaryY + 5);
      x += 50;
    }
  }

  const headers = Object.keys(data.rows[0]);
  const rows = data.rows.map(r => headers.map(h => String(r[h] ?? '')));

  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: Object.keys(data.summary).length ? 34 : 24,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [41, 55, 69], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  // Footer
  const pages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(`Generated ${new Date().toLocaleDateString('en-US', { dateStyle: 'long' })} · StoryPay`, 14, 205);
    doc.text(`Page ${i} of ${pages}`, 260, 205);
  }

  doc.save(`${label.replace(/\s+/g, '_')}.pdf`);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Preview table ────────────────────────────────────────────────────────────

function PreviewTable({ data }: { data: ReportData }) {
  const [expanded, setExpanded] = useState(false);
  if (!data.rows.length) return <p className="text-sm text-gray-400 py-4 text-center">No data for selected period.</p>;

  const headers = Object.keys(data.rows[0]);
  const visible = expanded ? data.rows : data.rows.slice(0, 5);

  return (
    <div>
      {/* Summary pills */}
      {Object.keys(data.summary).length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4">
          {Object.entries(data.summary).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5">
              <p className="text-lg font-bold text-gray-900">{v}</p>
              <p className="text-xs text-gray-500 mt-0.5">{k}</p>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {headers.map(h => (
                <th key={h} className="px-3 py-2.5 text-left font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visible.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50/60">
                {headers.map(h => (
                  <td key={h} className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{row[h]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.rows.length > 5 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-2 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          {expanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show all {data.rows.length} rows</>}
        </button>
      )}
    </div>
  );
}

// ─── Report card ─────────────────────────────────────────────────────────────

function ReportCard({ report, dateRange }: { report: ReportDef; dateRange: DateRange }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<Format | null>(null);
  const [error, setError] = useState('');
  const [previewing, setPreviewing] = useState(false);

  const Icon = report.icon;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ type: report.type, from: dateRange.from, to: dateRange.to });
      const res = await fetch(`/api/reports?${params}`);
      if (!res.ok) throw new Error('Failed to fetch report');
      const json = await res.json();
      setData(json);
      return json as ReportData;
    } catch {
      setError('Failed to load report data. Please try again.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [report.type, dateRange]);

  async function handlePreview() {
    if (!previewing) {
      const d = await fetchData();
      if (d) setPreviewing(true);
    } else {
      setPreviewing(false);
    }
  }

  async function handleDownload(fmt: Format) {
    setDownloading(fmt);
    try {
      const d = data ?? await fetchData();
      if (!d || !d.rows.length) { setError('No data available for this period.'); return; }
      if (fmt === 'csv')   await downloadCSV(d, report.label);
      if (fmt === 'excel') await downloadExcel(d, report.label);
      if (fmt === 'pdf')   await downloadPDF(d, report.label, dateRange);
    } catch (e) {
      setError('Download failed. Please try again.');
      console.error(e);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={classNames('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', report.bg)}>
              <Icon size={17} style={{ color: report.color }} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{report.label}</h3>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed max-w-lg">{report.description}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handlePreview}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Table2 size={12} />}
              {previewing ? 'Hide' : 'Preview'}
            </button>

            <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden divide-x divide-gray-200">
              {(['csv', 'excel', 'pdf'] as Format[]).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => handleDownload(fmt)}
                  disabled={!!downloading}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 uppercase tracking-wide"
                  title={`Download as ${fmt.toUpperCase()}`}
                >
                  {downloading === fmt
                    ? <Loader2 size={11} className="animate-spin" />
                    : <Download size={11} />}
                  {fmt === 'excel' ? <FileSpreadsheet size={11} /> : null}
                  {fmt}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      </div>

      {previewing && data && (
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50/40">
          <PreviewTable data={data} />
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultRange);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-gray-900">Reports</h1>
          <p className="mt-1 text-sm text-gray-500">Generate and download financial reports for accounting and insights</p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {/* Date range display */}
      <div className="mb-6 rounded-lg border border-brand-900/10 bg-brand-900/3 px-4 py-3 flex items-center gap-2">
        <span className="text-xs font-semibold text-brand-900 uppercase tracking-wider">Period:</span>
        <span className="text-sm text-gray-700 font-medium">{dateRange.label}</span>
        <span className="text-gray-400 text-sm">·</span>
        <span className="text-xs text-gray-500">{dateRange.from} to {dateRange.to}</span>
      </div>

      <div className="space-y-4">
        {REPORTS.map((report) => (
          <ReportCard key={report.type} report={report} dateRange={dateRange} />
        ))}
      </div>
    </div>
  );
}
