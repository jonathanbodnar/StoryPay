'use client';

/**
 * GhlMigrationPanel — super-admin "GHL Migration" tab.
 *
 * Allows migrating contacts from Go High Level into a StoryVenue sub-account
 * using a tag-based stage mapping.
 *
 * Workflow:
 *   1. Pick a venue
 *   2. Paste or upload a GHL CSV export
 *   3. Map CSV columns to the expected fields
 *   4. Preview the import (stage assignment shown per contact)
 *   5. Confirm → contacts are created with is_ghl_migration = true,
 *      automations permanently suppressed
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, AlertTriangle, CheckCircle2, Loader2,
  Building2, Users, ArrowRight, Info, RefreshCw, X,
  ChevronDown,
} from 'lucide-react';
import type { GhlContact, MappedContact, CommitResult } from '@/app/api/admin/migrate-ghl/route';

const BRAND = '#1b1b1b';

// ---------------------------------------------------------------------------
// GHL tag → stage name (mirrors the API-side mapping — displayed in UI)
// ---------------------------------------------------------------------------

const GHL_TAG_PRIORITY = [
  'booked_wedding',
  'booked_tour',
  'scheduled_tour',
  'tour_requested',
  'bride_replied',
  'pricing_guide',
  'cold_lead',
];

const GHL_TAG_TO_STAGE: Record<string, string | null> = {
  booked_wedding:  'Wedding Day',
  booked_tour:     'Booked Tour',
  scheduled_tour:  'Booked Tour',
  tour_requested:  'Booked Tour',
  bride_replied:   'Conversation Started',
  pricing_guide:   'Inquiry',
  cold_lead:       null,
};

function normalizeTag(t: string) {
  return t.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function resolveStageName(tags: string[]): string {
  const norm = tags.map(normalizeTag);
  for (const k of GHL_TAG_PRIORITY) {
    if (norm.includes(k)) return GHL_TAG_TO_STAGE[k] ?? 'Contact only';
  }
  return 'Contact only';
}

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

/** Parse a CSV string into rows (handles quoted fields). */
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

/** Detect common GHL column names → canonical key. */
const HEADER_ALIASES: Record<string, string> = {
  'first name': 'firstName', 'firstname': 'firstName', 'first_name': 'firstName',
  'last name':  'lastName',  'lastname':  'lastName',  'last_name':  'lastName',
  'email':      'email',     'email address': 'email',
  'phone':      'phone',     'phone number': 'phone',  'mobile': 'phone',
  'tags':       'tags',      'tag': 'tags',
  'wedding date': 'weddingDate', 'wedding_date': 'weddingDate',
  'guest count': 'guestCount',  'guest_count': 'guestCount', 'guests': 'guestCount',
  'notes': 'notes', 'note': 'notes', 'message': 'notes',
};

type ColumnKey = 'firstName' | 'lastName' | 'email' | 'phone' | 'tags' | 'weddingDate' | 'guestCount' | 'notes' | 'ignore';

const COLUMN_OPTIONS: { value: ColumnKey; label: string }[] = [
  { value: 'firstName',   label: 'First Name' },
  { value: 'lastName',    label: 'Last Name' },
  { value: 'email',       label: 'Email' },
  { value: 'phone',       label: 'Phone' },
  { value: 'tags',        label: 'Tags' },
  { value: 'weddingDate', label: 'Wedding Date' },
  { value: 'guestCount',  label: 'Guest Count' },
  { value: 'notes',       label: 'Notes' },
  { value: 'ignore',      label: '— Ignore —' },
];

interface VenueOption { id: string; name: string; }

// ---------------------------------------------------------------------------
// Stage badge helper
// ---------------------------------------------------------------------------

function StageBadge({ name }: { name: string }) {
  const colors: Record<string, string> = {
    'Wedding Day':         'bg-purple-100 text-purple-700',
    'Booked Tour':         'bg-blue-100 text-blue-700',
    'Conversation Started':'bg-amber-100 text-amber-700',
    'Inquiry':             'bg-emerald-100 text-emerald-700',
    'Contact only':        'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${colors[name] ?? 'bg-gray-100 text-gray-600'}`}>
      {name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function GhlMigrationPanel() {
  // Venues
  const [venues, setVenues]             = useState<VenueOption[]>([]);
  const [venueId, setVenueId]           = useState('');
  const [venueSearch, setVenueSearch]   = useState('');
  const [venueOpen, setVenueOpen]       = useState(false);

  // CSV state
  const [csvText, setCsvText]           = useState('');
  const [headers, setHeaders]           = useState<string[]>([]);
  const [dataRows, setDataRows]         = useState<string[][]>([]);
  const [columnMap, setColumnMap]       = useState<Record<number, ColumnKey>>({});

  // Step
  type Step = 'upload' | 'map' | 'preview' | 'done';
  const [step, setStep]                 = useState<Step>('upload');

  // Preview
  const [previewContacts, setPreviewContacts] = useState<MappedContact[]>([]);
  const [commitResult, setCommitResult] = useState<(CommitResult & { venue: { id: string; name: string } }) | null>(null);

  // Loading / error
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // Load venues
  // ---------------------------------------------------------------------------
  useEffect(() => {
    fetch('/api/admin/venues?limit=500', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const list = (d.venues ?? d ?? []) as Array<{ id: string; name: string }>;
        setVenues(list.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {});
  }, []);

  const selectedVenue = venues.find((v) => v.id === venueId);
  const filteredVenues = venues.filter((v) =>
    v.name.toLowerCase().includes(venueSearch.toLowerCase()),
  );

  // ---------------------------------------------------------------------------
  // CSV parsing
  // ---------------------------------------------------------------------------

  const parseAndAdvance = useCallback(() => {
    if (!csvText.trim()) { setError('Please paste or upload a CSV first.'); return; }
    const rows = parseCsv(csvText);
    if (rows.length < 2) { setError('CSV must have a header row and at least one data row.'); return; }

    const [headerRow, ...rest] = rows;
    setHeaders(headerRow);
    setDataRows(rest);

    // Auto-detect column mapping
    const autoMap: Record<number, ColumnKey> = {};
    for (let i = 0; i < headerRow.length; i++) {
      const key = HEADER_ALIASES[headerRow[i].toLowerCase().trim()];
      autoMap[i] = (key as ColumnKey) ?? 'ignore';
    }
    setColumnMap(autoMap);
    setError(null);
    setStep('map');
  }, [csvText]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setCsvText(ev.target?.result as string); };
    reader.readAsText(file);
  };

  // ---------------------------------------------------------------------------
  // Build contacts from rows + column map
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
        // GHL exports tags separated by commas or pipes
        const tags = tagsRaw
          ? tagsRaw.split(/[,|;]/).map((t) => t.trim()).filter(Boolean)
          : [];

        return {
          firstName:   get('firstName'),
          lastName:    get('lastName'),
          email:       get('email'),
          phone:       get('phone'),
          tags,
          weddingDate: get('weddingDate') || null,
          guestCount:  get('guestCount') ? Number(get('guestCount').replace(/\D/g, '')) || null : null,
          notes:       get('notes') || null,
        } satisfies GhlContact;
      })
      .filter((c) => c.email); // skip rows with no email
  }

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------

  const runPreview = useCallback(async () => {
    if (!venueId) { setError('Please select a venue first.'); return; }
    setLoading(true); setError(null);
    try {
      const contacts = buildContacts();
      if (!contacts.length) { setError('No valid contacts found (email required).'); setLoading(false); return; }
      const r = await fetch('/api/admin/migrate-ghl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, contacts, mode: 'preview' }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? 'Preview failed'); setLoading(false); return; }
      setPreviewContacts(d.contacts as MappedContact[]);
      setStep('preview');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, columnMap, dataRows]);

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
        body: JSON.stringify({ venueId, contacts, mode: 'commit' }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? 'Import failed'); setLoading(false); return; }
      setCommitResult(d);
      setStep('done');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, columnMap, dataRows]);

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  const reset = () => {
    setCsvText(''); setHeaders([]); setDataRows([]); setColumnMap({});
    setPreviewContacts([]); setCommitResult(null); setError(null); setStep('upload');
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const duplicateCount = previewContacts.filter((c) => c.isDuplicate).length;
  const newCount = previewContacts.length - duplicateCount;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">GHL → StoryVenue Migration</h2>
        <p className="mt-1 text-sm text-gray-500">
          Import contacts from a Go High Level CSV export. Tags are used to map contacts into
          the correct pipeline stage. Automations are permanently suppressed for all migrated contacts.
        </p>
      </div>

      {/* Tag mapping reference */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Info size={14} className="text-gray-400" />
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Tag → Stage Mapping</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          {GHL_TAG_PRIORITY.map((tag) => (
            <div key={tag} className="flex items-center gap-2">
              <code className="rounded bg-white border border-gray-200 px-1.5 py-0.5 font-mono text-gray-700">{tag}</code>
              <ArrowRight size={10} className="text-gray-300 flex-shrink-0" />
              <StageBadge name={GHL_TAG_TO_STAGE[tag] ?? 'Contact only'} />
            </div>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* Step: upload */}
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
          </div>

          {/* CSV input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              GHL CSV Export
            </label>
            <p className="text-xs text-gray-400 mb-2">
              Export contacts from GHL (Contacts → Export) and paste below, or upload the file.
              Ensure the export includes a <strong>Tags</strong> column.
            </p>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={10}
              placeholder="Paste CSV here — First Name,Last Name,Email,Phone Number,Tags,..."
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs shadow-sm outline-none focus:border-gray-500 resize-y"
            />
            <div className="mt-2 flex items-center gap-3">
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileUpload} />
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                <Upload size={12} />
                Upload CSV file
              </button>
              {csvText && <span className="text-xs text-gray-400">{csvText.split('\n').filter(Boolean).length} lines pasted</span>}
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

      {/* Step: map columns */}
      {step === 'map' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">
              Map Columns — {dataRows.length} rows detected
            </h3>
            <button onClick={() => setStep('upload')} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
              <RefreshCw size={11} /> Start over
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Review the auto-detected column mapping. Adjust any columns that were not correctly identified.
          </p>

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
                        className="rounded border border-gray-200 bg-white px-2 py-1 text-xs outline-none"
                      >
                        {COLUMN_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-gray-400 truncate max-w-[160px] hidden sm:table-cell">
                      {dataRows[0]?.[i] ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <button onClick={() => setStep('upload')} className="text-xs text-gray-400 hover:text-gray-600">← Back</button>
          </div>
        </div>
      )}

      {/* Step: preview */}
      {step === 'preview' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">
                Preview — {previewContacts.length} contacts for <span className="text-gray-900">{selectedVenue?.name}</span>
              </h3>
              <p className="mt-0.5 text-xs text-gray-500">
                {newCount} new · {duplicateCount > 0 ? `${duplicateCount} duplicate${duplicateCount > 1 ? 's' : ''} (will still import)` : 'no duplicates'}
              </p>
            </div>
            <button onClick={() => setStep('map')} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 flex-shrink-0">
              <RefreshCw size={11} /> Back
            </button>
          </div>

          {/* Warning for duplicates */}
          {duplicateCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                {duplicateCount} contact{duplicateCount > 1 ? 's' : ''} already exist{duplicateCount === 1 ? 's' : ''} in this venue.
                They will be imported again as new leads. The <code>venue_customers</code> record will be updated with the latest stage.
              </span>
            </div>
          )}

          {/* Automation notice */}
          <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-700">
            <Info size={14} className="mt-0.5 flex-shrink-0" />
            <span>
              All imported contacts will be permanently flagged <strong>is_ghl_migration = true</strong>.
              No Speed-to-Lead sequences, 14-day drip emails, or SMS automations will ever fire for them.
            </span>
          </div>

          {/* Preview table */}
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Name</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Email</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">Phone</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">GHL Tags</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">→ Stage</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {previewContacts.slice(0, 200).map((c, i) => (
                  <tr key={i} className={`border-b border-gray-100 last:border-0 ${c.isDuplicate ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {c.firstName} {c.lastName}
                    </td>
                    <td className="px-3 py-2 text-gray-600 max-w-[160px] truncate">{c.email}</td>
                    <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">{c.phone || '—'}</td>
                    <td className="px-3 py-2 max-w-[180px]">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.slice(0, 4).map((t) => (
                          <span
                            key={t}
                            className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] ${
                              c.matchedTag && normalizeTag(t) === c.matchedTag
                                ? 'bg-gray-800 text-white'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {t}
                          </span>
                        ))}
                        {c.tags.length > 4 && (
                          <span className="text-gray-400 text-[10px]">+{c.tags.length - 4}</span>
                        )}
                        {c.tags.length === 0 && <span className="text-gray-300">none</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StageBadge name={c.stageName ?? 'Contact only'} />
                    </td>
                    <td className="px-3 py-2">
                      {c.isDuplicate ? (
                        <span className="text-amber-600 font-medium">Duplicate</span>
                      ) : (
                        <span className="text-emerald-600 font-medium">New</span>
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
            <button onClick={() => setStep('map')} className="text-xs text-gray-400 hover:text-gray-600">← Back</button>
          </div>
        </div>
      )}

      {/* Step: done */}
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

          <div className="flex items-center gap-3">
            <button
              onClick={reset}
              style={{ backgroundColor: BRAND }}
              className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
            >
              <RefreshCw size={14} />
              Import another account
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
