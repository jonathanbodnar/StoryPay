'use client';

/**
 * GhlMigrationPanel — super-admin "GHL Migration" tab.
 *
 * Imports GHL contacts into a StoryVenue sub-account.
 * Stage resolution order:
 *   1. GHL pipeline stage column → user-confirmed mapping → SV stage
 *   2. Tag fallback (booked_wedding, bride_replied, etc.)
 *   3. Contact only (no pipeline)
 *
 * Steps:
 *   upload → map-columns → map-stages → preview → done
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, AlertTriangle, CheckCircle2, Loader2,
  Building2, Users, ArrowRight, Info, RefreshCw, X,
  ChevronDown, Tag,
} from 'lucide-react';
import type { GhlContact, MappedContact, CommitResult, PipelineStage } from '@/app/api/admin/migrate-ghl/route';

const BRAND = '#1b1b1b';

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        fields.push(cur.trim()); cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    rows.push(fields);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

type ColumnKey =
  | 'firstName' | 'lastName' | 'email' | 'phone'
  | 'ghlStage'   // ← NEW: GHL pipeline stage column
  | 'tags' | 'weddingDate' | 'guestCount' | 'notes'
  | 'ignore';

const COLUMN_OPTIONS: { value: ColumnKey; label: string }[] = [
  { value: 'firstName',   label: 'First Name' },
  { value: 'lastName',    label: 'Last Name' },
  { value: 'email',       label: 'Email' },
  { value: 'phone',       label: 'Phone' },
  { value: 'ghlStage',    label: 'GHL Stage (pipeline)' },
  { value: 'tags',        label: 'Tags' },
  { value: 'weddingDate', label: 'Wedding Date' },
  { value: 'guestCount',  label: 'Guest Count' },
  { value: 'notes',       label: 'Notes' },
  { value: 'ignore',      label: '— Ignore —' },
];

const HEADER_ALIASES: Record<string, ColumnKey> = {
  // name
  'first name': 'firstName', firstname: 'firstName', first_name: 'firstName',
  'last name':  'lastName',  lastname:  'lastName',  last_name:  'lastName',
  // contact
  email: 'email', 'email address': 'email',
  phone: 'phone', 'phone number': 'phone', mobile: 'phone',
  // stage  ← auto-detect GHL stage column
  stage: 'ghlStage', 'pipeline stage': 'ghlStage', 'current stage': 'ghlStage',
  'stage name': 'ghlStage',
  // tags
  tags: 'tags', tag: 'tags',
  // extras
  'wedding date': 'weddingDate', wedding_date: 'weddingDate',
  'guest count': 'guestCount',  guest_count: 'guestCount', guests: 'guestCount',
  notes: 'notes', note: 'notes', message: 'notes',
};

// ---------------------------------------------------------------------------
// Tag fallback reference (UI display only — logic lives in the API)
// ---------------------------------------------------------------------------

const TAG_FALLBACK_MAP: Record<string, string | null> = {
  booked_wedding:  'Wedding Day',
  booked_tour:     'Booked Tour',
  scheduled_tour:  'Booked Tour',
  tour_requested:  'Booked Tour',
  bride_replied:   'Conversation Started',
  pricing_guide:   'Inquiry',
  cold_lead:       null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StageBadge({ name, dim }: { name: string; dim?: boolean }) {
  const colors: Record<string, string> = {
    'Wedding Day':          'bg-purple-100 text-purple-700',
    'Booked Tour':          'bg-blue-100 text-blue-700',
    'Conversation Started': 'bg-amber-100 text-amber-700',
    'Inquiry':              'bg-emerald-100 text-emerald-700',
    'Contact only':         'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${dim ? 'opacity-50' : ''} ${colors[name] ?? 'bg-gray-100 text-gray-600'}`}>
      {name}
    </span>
  );
}

type VenueOption = { id: string; name: string };
type Step = 'upload' | 'map-columns' | 'map-stages' | 'preview' | 'done';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function GhlMigrationPanel() {
  // Venue
  const [venues, setVenues]           = useState<VenueOption[]>([]);
  const [venueId, setVenueId]         = useState('');
  const [venueSearch, setVenueSearch] = useState('');
  const [venueOpen, setVenueOpen]     = useState(false);

  // CSV
  const [csvText, setCsvText]         = useState('');
  const [headers, setHeaders]         = useState<string[]>([]);
  const [dataRows, setDataRows]       = useState<string[][]>([]);
  const [columnMap, setColumnMap]     = useState<Record<number, ColumnKey>>({});

  // Stage mapping step
  const [svStages, setSvStages]       = useState<PipelineStage[]>([]);
  const [svPipelineName, setSvPipelineName] = useState<string | null>(null);
  /** Map of unique GHL stage names → chosen SV stage name (null = Contact only) */
  const [stageMapping, setStageMapping] = useState<Record<string, string | null>>({});

  // Preview / result
  const [previewContacts, setPreviewContacts] = useState<MappedContact[]>([]);
  const [commitResult, setCommitResult]       = useState<(CommitResult & { venue: { id: string; name: string } }) | null>(null);

  // State
  const [step, setStep]               = useState<Step>('upload');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // Load venues
  // ---------------------------------------------------------------------------
  useEffect(() => {
    fetch('/api/admin/venues?limit=500', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const list = (d.venues ?? d ?? []) as VenueOption[];
        setVenues(list.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {});
  }, []);

  const selectedVenue = venues.find((v) => v.id === venueId);
  const filteredVenues = venues.filter((v) =>
    v.name.toLowerCase().includes(venueSearch.toLowerCase()),
  );

  // ---------------------------------------------------------------------------
  // Load SV pipeline stages when venue changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!venueId) { setSvStages([]); setSvPipelineName(null); return; }
    fetch(`/api/admin/migrate-ghl?venueId=${venueId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setSvStages((d.stages ?? []) as PipelineStage[]);
        setSvPipelineName((d.pipelineName as string | null) ?? null);
      })
      .catch(() => {});
  }, [venueId]);

  // ---------------------------------------------------------------------------
  // CSV parsing → column map step
  // ---------------------------------------------------------------------------
  const parseAndAdvance = useCallback(() => {
    if (!csvText.trim()) { setError('Please paste or upload a CSV first.'); return; }
    const rows = parseCsv(csvText);
    if (rows.length < 2) { setError('CSV must have a header row and at least one data row.'); return; }
    const [headerRow, ...rest] = rows;
    setHeaders(headerRow);
    setDataRows(rest);
    const autoMap: Record<number, ColumnKey> = {};
    for (let i = 0; i < headerRow.length; i++) {
      autoMap[i] = HEADER_ALIASES[headerRow[i].toLowerCase().trim()] ?? 'ignore';
    }
    setColumnMap(autoMap);
    setError(null);
    setStep('map-columns');
  }, [csvText]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target?.result as string);
    reader.readAsText(file);
  };

  // ---------------------------------------------------------------------------
  // Build GhlContact objects from rows + column map
  // ---------------------------------------------------------------------------
  function buildContacts(): GhlContact[] {
    return dataRows
      .map((row) => {
        const get = (key: ColumnKey): string => {
          const idx = Object.entries(columnMap).find(([, v]) => v === key)?.[0];
          if (idx === undefined) return '';
          return row[Number(idx)]?.trim() ?? '';
        };
        const tagsRaw = get('tags');
        const tags = tagsRaw
          ? tagsRaw.split(/[,|;]/).map((t) => t.trim()).filter(Boolean)
          : [];
        return {
          firstName:   get('firstName'),
          lastName:    get('lastName'),
          email:       get('email'),
          phone:       get('phone'),
          ghlStage:    get('ghlStage') || null,
          tags,
          weddingDate: get('weddingDate') || null,
          guestCount:  get('guestCount') ? Number(get('guestCount').replace(/\D/g, '')) || null : null,
          notes:       get('notes') || null,
        } satisfies GhlContact;
      })
      .filter((c) => c.email);
  }

  // ---------------------------------------------------------------------------
  // Advance from column map → stage mapping step
  // ---------------------------------------------------------------------------
  const advanceToStageMap = useCallback(() => {
    if (!venueId) { setError('Please select a venue first.'); return; }
    const contacts = buildContacts();
    if (!contacts.length) { setError('No valid contacts found (email required).'); return; }

    // Collect unique GHL stage names from the CSV
    const uniqueGhlStages = Array.from(
      new Set(contacts.map((c) => c.ghlStage).filter((s): s is string => !!s?.trim())),
    ).sort();

    // Pre-populate stageMapping with smart defaults (exact name match first,
    // then first-word fuzzy match against SV stages)
    const autoMapping: Record<string, string | null> = {};
    for (const ghlStage of uniqueGhlStages) {
      const lower = ghlStage.toLowerCase().trim();
      // Try exact match
      const exact = svStages.find((s) => s.name.toLowerCase().trim() === lower);
      if (exact) { autoMapping[ghlStage] = exact.name; continue; }
      // Fuzzy: any SV stage whose name is contained in or contains the GHL stage
      const fuzzy = svStages.find((s) =>
        lower.includes(s.name.toLowerCase().trim()) || s.name.toLowerCase().trim().includes(lower),
      );
      autoMapping[ghlStage] = fuzzy?.name ?? null;
    }

    setStageMapping(autoMapping);
    setError(null);
    setStep('map-stages');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, columnMap, dataRows, svStages]);

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------
  const runPreview = useCallback(async () => {
    if (!venueId) { setError('Please select a venue first.'); return; }
    setLoading(true); setError(null);
    try {
      const contacts = buildContacts();
      const r = await fetch('/api/admin/migrate-ghl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, contacts, stageMapping, mode: 'preview' }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? 'Preview failed'); return; }
      setPreviewContacts(d.contacts as MappedContact[]);
      setStep('preview');
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, columnMap, dataRows, stageMapping]);

  // ---------------------------------------------------------------------------
  // Commit
  // ---------------------------------------------------------------------------
  const runCommit = useCallback(async () => {
    if (!venueId) return;
    setLoading(true); setError(null);
    try {
      const contacts = buildContacts();
      const r = await fetch('/api/admin/migrate-ghl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, contacts, stageMapping, mode: 'commit' }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? 'Import failed'); return; }
      setCommitResult(d);
      setStep('done');
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, columnMap, dataRows, stageMapping]);

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------
  const reset = () => {
    setCsvText(''); setHeaders([]); setDataRows([]); setColumnMap({});
    setStageMapping({}); setPreviewContacts([]); setCommitResult(null);
    setError(null); setStep('upload');
  };

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const duplicateCount = previewContacts.filter((c) => c.isDuplicate).length;
  const newCount       = previewContacts.length - duplicateCount;
  const uniqueGhlStages = Array.from(
    new Set(dataRows.map((row) => {
      const idx = Object.entries(columnMap).find(([, v]) => v === 'ghlStage')?.[0];
      return idx !== undefined ? row[Number(idx)]?.trim() : '';
    }).filter(Boolean)),
  ).sort();
  const hasStageColumn = Object.values(columnMap).includes('ghlStage');

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">GHL → StoryVenue Migration</h2>
        <p className="mt-1 text-sm text-gray-500">
          Import contacts from a Go High Level CSV export. Pipeline stages are matched 1:1 to
          StoryVenue stages. Tags are used as a fallback when no stage column is present.
          All automations are permanently suppressed for migrated contacts.
        </p>
      </div>

      {/* Progress breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        {(['upload', 'map-columns', 'map-stages', 'preview', 'done'] as Step[]).map((s, i, arr) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={step === s ? 'font-semibold text-gray-900' : ''}>
              {s === 'upload' ? 'Upload' : s === 'map-columns' ? 'Columns' : s === 'map-stages' ? 'Stages' : s === 'preview' ? 'Preview' : 'Done'}
            </span>
            {i < arr.length - 1 && <ArrowRight size={10} className="text-gray-300" />}
          </span>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* ── STEP: upload ── */}
      {step === 'upload' && (
        <div className="flex flex-col gap-4">
          {/* Venue selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Venue</label>
            <div className="relative">
              <button
                onClick={() => setVenueOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-left shadow-sm hover:border-gray-400"
              >
                <span className="flex items-center gap-2">
                  <Building2 size={14} className="text-gray-400" />
                  {selectedVenue ? selectedVenue.name : <span className="text-gray-400">Select a venue…</span>}
                </span>
                <ChevronDown size={14} className="text-gray-400" />
              </button>
              {venueOpen && (
                <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
                  <div className="p-2">
                    <input
                      autoFocus
                      value={venueSearch}
                      onChange={(e) => setVenueSearch(e.target.value)}
                      placeholder="Search venues…"
                      className="w-full rounded border border-gray-200 px-2 py-1 text-sm outline-none"
                    />
                  </div>
                  <ul className="max-h-48 overflow-y-auto">
                    {filteredVenues.map((v) => (
                      <li key={v.id}>
                        <button
                          onClick={() => { setVenueId(v.id); setVenueOpen(false); setVenueSearch(''); }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 truncate"
                        >
                          {v.name}
                        </button>
                      </li>
                    ))}
                    {filteredVenues.length === 0 && (
                      <li className="px-3 py-2 text-sm text-gray-400">No venues found</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
            {venueId && svStages.length > 0 && (
              <p className="mt-1 text-xs text-gray-400">
                Pipeline: <span className="font-medium text-gray-600">{svPipelineName}</span> —
                {svStages.length} stages: {svStages.map((s) => s.name).join(', ')}
              </p>
            )}
          </div>

          {/* CSV input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">GHL CSV Export</label>
            <p className="text-xs text-gray-400 mb-2">
              In GHL: <strong>Contacts → Export</strong>. Make sure the export includes{' '}
              <strong>Stage</strong> and <strong>Tags</strong> columns for best results.
            </p>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={10}
              placeholder="Paste CSV here — First Name,Last Name,Email,Phone Number,Stage,Tags,..."
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs shadow-sm outline-none focus:border-gray-500 resize-y"
            />
            <div className="mt-2 flex items-center gap-3">
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileUpload} />
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                <Upload size={12} /> Upload CSV file
              </button>
              {csvText && <span className="text-xs text-gray-400">{csvText.split('\n').filter(Boolean).length} lines</span>}
            </div>
          </div>

          <button
            onClick={parseAndAdvance}
            disabled={!csvText.trim() || !venueId}
            style={{ backgroundColor: BRAND }}
            className="self-start rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Parse CSV →
          </button>
        </div>
      )}

      {/* ── STEP: map columns ── */}
      {step === 'map-columns' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">
              Map Columns — {dataRows.length} rows detected
            </h3>
            <button onClick={() => setStep('upload')} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
              <RefreshCw size={11} /> Start over
            </button>
          </div>

          {!hasStageColumn && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              No <strong>Stage</strong> column auto-detected. Map the correct column below, or the tool will fall back to tag-based stage assignment.
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-3 py-2 text-left font-medium text-gray-600">CSV Column</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Map to</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">Sample value</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((h, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 font-mono text-gray-700">{h}</td>
                    <td className="px-3 py-2">
                      <select
                        value={columnMap[i] ?? 'ignore'}
                        onChange={(e) => setColumnMap((m) => ({ ...m, [i]: e.target.value as ColumnKey }))}
                        className={`rounded border px-2 py-1 text-xs outline-none ${
                          columnMap[i] === 'ghlStage' ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'
                        }`}
                      >
                        {COLUMN_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-gray-400 truncate max-w-[180px] hidden sm:table-cell">
                      {dataRows[0]?.[i] ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={advanceToStageMap}
              disabled={!venueId}
              style={{ backgroundColor: BRAND }}
              className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              <ArrowRight size={14} />
              Next: Map Stages
            </button>
            <button onClick={() => setStep('upload')} className="text-xs text-gray-400 hover:text-gray-600">← Back</button>
          </div>
        </div>
      )}

      {/* ── STEP: map stages ── */}
      {step === 'map-stages' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Map GHL Stages → StoryVenue Stages</h3>
              <p className="mt-0.5 text-xs text-gray-500">
                {uniqueGhlStages.length} unique stage{uniqueGhlStages.length !== 1 ? 's' : ''} found in this CSV.
                Smart defaults are pre-filled — adjust any that look wrong.
              </p>
            </div>
            <button onClick={() => setStep('map-columns')} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
              <RefreshCw size={11} /> Back
            </button>
          </div>

          {uniqueGhlStages.length === 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              No GHL stage values found. The stage column may be empty in this CSV.
              You can still import — contacts will be assigned via tag fallback or as Contact only.
            </div>
          )}

          {uniqueGhlStages.length > 0 && (
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-xs font-medium text-gray-500">
                <span>GHL Stage (in their pipeline)</span>
                <ArrowRight size={12} className="text-gray-300" />
                <span>StoryVenue Stage</span>
              </div>
              <div className="divide-y divide-gray-100">
                {uniqueGhlStages.map((ghlStage) => {
                  const count = dataRows.filter((row) => {
                    const idx = Object.entries(columnMap).find(([, v]) => v === 'ghlStage')?.[0];
                    return idx !== undefined && row[Number(idx)]?.trim() === ghlStage;
                  }).length;
                  return (
                    <div key={ghlStage} className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-3">
                      <div>
                        <span className="font-medium text-sm text-gray-800">{ghlStage}</span>
                        <span className="ml-2 text-xs text-gray-400">{count} contact{count !== 1 ? 's' : ''}</span>
                      </div>
                      <ArrowRight size={12} className="text-gray-300 flex-shrink-0" />
                      <select
                        value={stageMapping[ghlStage] ?? '__contact_only__'}
                        onChange={(e) => setStageMapping((m) => ({
                          ...m,
                          [ghlStage]: e.target.value === '__contact_only__' ? null : e.target.value,
                        }))}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-gray-500 w-full"
                      >
                        <option value="__contact_only__">Contact only (no pipeline)</option>
                        {svStages.map((s) => (
                          <option key={s.id} value={s.name}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tag fallback note */}
          <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-700">
            <Tag size={14} className="mt-0.5 flex-shrink-0" />
            <span>
              Contacts without a stage value (or with an unmapped stage) will fall back to tag-based assignment:
              <strong> booked_wedding → Wedding Day, bride_replied → Conversation Started,</strong> etc.
              If no tag matches either, they are imported as contacts only.
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={runPreview}
              disabled={loading || !venueId}
              style={{ backgroundColor: BRAND }}
              className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              Preview import
            </button>
            <button onClick={() => setStep('map-columns')} className="text-xs text-gray-400 hover:text-gray-600">← Back</button>
          </div>
        </div>
      )}

      {/* ── STEP: preview ── */}
      {step === 'preview' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">
                Preview — {previewContacts.length} contacts for{' '}
                <span className="text-gray-900">{selectedVenue?.name}</span>
              </h3>
              <p className="mt-0.5 text-xs text-gray-500">
                {newCount} new · {duplicateCount > 0 ? `${duplicateCount} duplicate${duplicateCount > 1 ? 's' : ''}` : 'no duplicates'}
              </p>
            </div>
            <button onClick={() => setStep('map-stages')} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 flex-shrink-0">
              <RefreshCw size={11} /> Back
            </button>
          </div>

          {duplicateCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              {duplicateCount} contact{duplicateCount > 1 ? 's' : ''} already exist in this venue.
              They will be imported as new leads and the <code>venue_customers</code> record updated with the latest stage.
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-700">
            <Info size={14} className="mt-0.5 flex-shrink-0" />
            All contacts flagged <strong>is_ghl_migration = true</strong>. No Speed-to-Lead sequences, 14-day drip, or SMS automations will ever fire.
          </div>

          {/* Summary by stage */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from(
              previewContacts.reduce((acc, c) => {
                const key = c.stageName ?? 'Contact only';
                acc.set(key, (acc.get(key) ?? 0) + 1);
                return acc;
              }, new Map<string, number>()),
            ).map(([name, count]) => (
              <div key={name} className="rounded-xl border border-gray-200 bg-white p-3 text-center">
                <div className="text-xl font-bold text-gray-900">{count}</div>
                <div className="mt-1"><StageBadge name={name} /></div>
              </div>
            ))}
          </div>

          {/* Contact table */}
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Name</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Email</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">GHL Stage</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">→ SV Stage</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">Via</th>
                </tr>
              </thead>
              <tbody>
                {previewContacts.slice(0, 200).map((c, i) => (
                  <tr key={i} className={`border-b border-gray-100 last:border-0 ${c.isDuplicate ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-3 py-2 font-medium text-gray-900">{c.firstName} {c.lastName}</td>
                    <td className="px-3 py-2 text-gray-500 max-w-[160px] truncate">{c.email}</td>
                    <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">{c.ghlStage || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2"><StageBadge name={c.stageName ?? 'Contact only'} /></td>
                    <td className="px-3 py-2 hidden sm:table-cell">
                      {c.resolvedBy === 'stage' && (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 font-medium">stage</span>
                      )}
                      {c.resolvedBy === 'tag' && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 font-medium" title={c.matchedTag ?? ''}>tag</span>
                      )}
                      {c.resolvedBy === 'none' && (
                        <span className="text-gray-300 text-[10px]">none</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {previewContacts.length > 200 && (
              <div className="px-3 py-2 text-xs text-gray-400 text-center border-t border-gray-100">
                Showing first 200 of {previewContacts.length} contacts
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={runCommit}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              style={{ backgroundColor: '#059669' }}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
              Import {previewContacts.length} contact{previewContacts.length !== 1 ? 's' : ''} into {selectedVenue?.name}
            </button>
            <button onClick={() => setStep('map-stages')} className="text-xs text-gray-400 hover:text-gray-600">← Back</button>
          </div>
        </div>
      )}

      {/* ── STEP: done ── */}
      {step === 'done' && commitResult && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <div className="flex items-center gap-3 mb-3">
              <CheckCircle2 size={20} className="text-emerald-600" />
              <h3 className="text-sm font-semibold text-emerald-800">
                Import complete — {commitResult.imported} contact{commitResult.imported !== 1 ? 's' : ''} added to {commitResult.venue.name}
              </h3>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-2xl font-bold text-emerald-700">{commitResult.imported}</div>
                <div className="text-xs text-emerald-600">Imported</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-600">{commitResult.skipped}</div>
                <div className="text-xs text-gray-500">Skipped</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">{commitResult.errors.length}</div>
                <div className="text-xs text-red-500">Errors</div>
              </div>
            </div>
          </div>

          {commitResult.errors.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <h4 className="text-xs font-semibold text-red-700 mb-2">Import errors</h4>
              <ul className="space-y-1">
                {commitResult.errors.map((e, i) => (
                  <li key={i} className="text-xs text-red-600">
                    <span className="font-mono">{e.email}</span> — {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={reset}
            style={{ backgroundColor: BRAND }}
            className="self-start flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
          >
            <RefreshCw size={14} /> Import another account
          </button>
        </div>
      )}
    </div>
  );
}
