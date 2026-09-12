'use client';

import { useCallback, useState } from 'react';
import {
  Plus,
  Trash2,
  Download,
  Loader2,
  Save,
  Sparkles,
  Image as ImageIcon,
  FileText,
  Check,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import {
  EMPTY_TIMELINE,
  sanitizeTimeline,
  starterTimeline,
  formatTimeLabel,
  newTimelineId,
  type TimelineEvent,
  type WeddingTimeline,
} from '@/lib/wedding-timeline';

type SaveResult = { ok: boolean; conflict?: boolean; timeline?: WeddingTimeline };

interface TimelineEditorProps {
  initial: WeddingTimeline;
  onSave: (next: WeddingTimeline) => Promise<SaveResult>;
  /** Couple names / label shown on the exported image + PDF header. */
  heading?: string;
  /** Formatted wedding date shown under the heading on exports. */
  dateLabel?: string;
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'wedding-day-timeline';
}

export default function TimelineEditor({ initial, onSave, heading, dateLabel }: TimelineEditorProps) {
  const [rev, setRev] = useState<number>(initial?.rev ?? 0);
  const [events, setEvents] = useState<TimelineEvent[]>(initial?.events ?? []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');

  const mutate = useCallback((updater: (prev: TimelineEvent[]) => TimelineEvent[]) => {
    setEvents((prev) => updater(prev));
    setDirty(true);
    setSavedFlash(false);
    setConflict(false);
  }, []);

  function updateRow(id: string, patch: Partial<TimelineEvent>) {
    mutate((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }
  function removeRow(id: string) {
    mutate((prev) => prev.filter((e) => e.id !== id));
  }
  function addRow() {
    mutate((prev) => [...prev, { id: newTimelineId(), time: '', title: '', note: null }]);
  }
  function applyStarter() {
    mutate(() => starterTimeline());
  }
  function sortByTime() {
    mutate((prev) => sanitizeTimeline({ rev, events: prev }).events);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const cleaned = sanitizeTimeline({ rev, events });
      const res = await onSave({ rev, events: cleaned.events });
      if (res.conflict) {
        if (res.timeline) {
          setEvents(res.timeline.events);
          setRev(res.timeline.rev);
        }
        setConflict(true);
        setDirty(false);
        return;
      }
      if (!res.ok) {
        setError('Could not save. Please try again.');
        return;
      }
      if (res.timeline) {
        setEvents(res.timeline.events);
        setRev(res.timeline.rev);
      }
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  // ---- Export (PNG + PDF share a single canvas render) ----------------------

  const renderToCanvas = useCallback((): HTMLCanvasElement => {
    const rows = sanitizeTimeline({ rev, events }).events;
    const scale = 2;
    const W = 900;
    const padding = 48;
    const lineX = padding + 128;
    const rowH = 68;
    const hasSub = Boolean(dateLabel);
    const titleText = (heading && heading.trim()) || 'Wedding Day Timeline';
    const listTop = 60 + (heading ? 44 : 0) + (hasSub ? 34 : 0) + 24;
    const H = Math.max(listTop + rows.length * rowH + 76, listTop + 120);

    const cv = document.createElement('canvas');
    cv.width = W * scale;
    cv.height = H * scale;
    const ctx = cv.getContext('2d')!;
    ctx.scale(scale, scale);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Header
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#111827';
    ctx.font = "700 34px Georgia, 'Times New Roman', serif";
    ctx.textAlign = 'center';
    ctx.fillText(titleText, W / 2, 74);
    if (heading) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = "600 16px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.fillText('WEDDING DAY TIMELINE', W / 2, 100);
    }
    if (hasSub) {
      ctx.fillStyle = '#6b7280';
      ctx.font = "400 18px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.fillText(dateLabel as string, W / 2, heading ? 128 : 104);
    }

    if (rows.length === 0) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = "400 18px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.textAlign = 'center';
      ctx.fillText('No events yet.', W / 2, listTop + 40);
      return cv;
    }

    // Vertical spine
    const firstY = listTop + 22;
    const lastY = listTop + (rows.length - 1) * rowH + 22;
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lineX, firstY);
    ctx.lineTo(lineX, lastY);
    ctx.stroke();

    rows.forEach((ev, i) => {
      const cy = listTop + i * rowH + 22;

      // dot
      ctx.beginPath();
      ctx.fillStyle = '#e11d48';
      ctx.arc(lineX, cy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = '#fecdd3';
      ctx.arc(lineX, cy, 11, 0, Math.PI * 2);
      ctx.globalAlpha = 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;

      // time (right of the left margin, before the spine)
      ctx.textAlign = 'right';
      ctx.fillStyle = '#6b7280';
      ctx.font = "600 18px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.fillText(formatTimeLabel(ev.time) || '—', lineX - 24, cy + 6);

      // title + note (right of the spine)
      ctx.textAlign = 'left';
      ctx.fillStyle = '#111827';
      ctx.font = "600 20px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.fillText(ev.title || 'Untitled', lineX + 28, cy + (ev.note ? -2 : 6));
      if (ev.note) {
        ctx.fillStyle = '#6b7280';
        ctx.font = "400 15px system-ui, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText(ev.note, lineX + 28, cy + 20);
      }
    });

    // Footer
    ctx.textAlign = 'center';
    ctx.fillStyle = '#c7cbd1';
    ctx.font = "400 13px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.fillText('Created with StoryVenue', W / 2, H - 26);

    return cv;
  }, [rev, events, heading, dateLabel]);

  const fileBase = slugify(heading ? `${heading} wedding day timeline` : 'wedding day timeline');

  function downloadPng() {
    const cv = renderToCanvas();
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = `${fileBase}.png`;
    a.click();
  }

  const [pdfBusy, setPdfBusy] = useState(false);
  async function downloadPdf() {
    setPdfBusy(true);
    try {
      const cv = renderToCanvas();
      const imgData = cv.toDataURL('image/png');
      const { default: jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const imgW = pageW - margin * 2;
      const imgH = (cv.height / cv.width) * imgW;

      if (imgH <= pageH - margin * 2) {
        pdf.addImage(imgData, 'PNG', margin, margin, imgW, imgH);
      } else {
        // Taller than one page — tile the same image across pages.
        const usable = pageH - margin * 2;
        let heightLeft = imgH;
        let position = margin;
        pdf.addImage(imgData, 'PNG', margin, position, imgW, imgH);
        heightLeft -= usable;
        while (heightLeft > 0) {
          pdf.addPage();
          position = margin - (imgH - heightLeft);
          pdf.addImage(imgData, 'PNG', margin, position, imgW, imgH);
          heightLeft -= usable;
        }
      }
      pdf.save(`${fileBase}.pdf`);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85"
          >
            <Plus className="h-4 w-4" /> Add event
          </button>
          {events.length > 0 && (
            <button
              type="button"
              onClick={sortByTime}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Clock className="h-4 w-4" /> Sort by time
            </button>
          )}
          <button
            type="button"
            onClick={applyStarter}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            title="Fill a typical wedding-day schedule you can edit"
          >
            <Sparkles className="h-4 w-4" /> Starter template
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={downloadPng}
            disabled={events.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <ImageIcon className="h-4 w-4" /> PNG
          </button>
          <button
            type="button"
            onClick={() => void downloadPdf()}
            disabled={events.length === 0 || pdfBusy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} PDF
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : savedFlash ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {savedFlash ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {conflict && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>The timeline was updated by someone else, so we loaded the latest version. Re-apply your changes and save again.</span>
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {/* Rows */}
      {events.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <Clock className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-600">Build your wedding-day schedule.</p>
          <p className="mt-1 text-xs text-gray-400">Add events one at a time, or start from a template.</p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={applyStarter}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85"
            >
              <Sparkles className="h-4 w-4" /> Use starter template
            </button>
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-4 w-4" /> Add first event
            </button>
          </div>
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {events.map((ev) => (
            <li
              key={ev.id}
              className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 sm:flex-nowrap"
            >
              <input
                type="time"
                value={ev.time}
                onChange={(e) => updateRow(ev.id, { time: e.target.value })}
                onBlur={sortByTime}
                style={{ accentColor: '#1b1b1b' }}
                className="w-28 shrink-0 rounded-lg border border-gray-200 px-2.5 py-2 text-sm text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <input
                type="text"
                value={ev.title}
                onChange={(e) => updateRow(ev.id, { title: e.target.value })}
                placeholder="Event (e.g. Ceremony)"
                className="min-w-[140px] flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
              />
              <input
                type="text"
                value={ev.note ?? ''}
                onChange={(e) => updateRow(ev.id, { note: e.target.value })}
                placeholder="Note (optional)"
                className="min-w-[120px] flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 focus:border-gray-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => removeRow(ev.id)}
                className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                title="Remove event"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {events.length > 0 && (
        <div className="mt-4 flex items-center gap-2 text-xs text-gray-400">
          <Download className="h-3.5 w-3.5" />
          Download a printable PNG or PDF to share with your vendors and wedding party.
        </div>
      )}
    </div>
  );
}

export { EMPTY_TIMELINE };
