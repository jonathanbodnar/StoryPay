'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  X, User, Mail, Phone, MapPin, Heart, Calendar,
  ClipboardList, Loader2, ExternalLink, Pencil,
  ChevronRight, AlertCircle, Smartphone, Check,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────
interface VenueCustomer {
  id: string;
  first_name: string;
  last_name: string;
  customer_email: string;
  phone: string | null;
  sms_dnd?: boolean;
  sms_dnd_at?: string | null;
  sms_dnd_source?: string | null;
  partner_first_name: string | null;
  partner_last_name: string | null;
  partner_email: string | null;
  partner_phone: string | null;
  wedding_date: string | null;
  guest_count: number | null;
  ceremony_type: string | null;
  rehearsal_date: string | null;
  coordinator_name: string | null;
  coordinator_phone: string | null;
  catering_notes: string | null;
  referral_source: string | null;
  pipeline_stage: string;
  pipeline_id?: string | null;
  stage_id?: string | null;
  pipeline_context?: {
    pipelineId: string;
    stageId: string;
    linkedLeadId: string | null;
  } | null;
}

interface PipelineStage {
  id: string;
  name: string;
  color: string;
  kind: string;
  position: number;
}

interface Pipeline {
  id: string;
  name: string;
  is_default: boolean;
  stages: PipelineStage[];
}

interface Note {
  id: string;
  content: string;
  author_name: string | null;
  created_at: string;
}

interface LeadInquiry {
  booking_timeline: string | null;
  venue_matters: string | null;
}

function isPlaceholderEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return !e || !e.includes('@') || e.endsWith('@storypay.internal') || e.includes('@ghl-sms.storypay.placeholder');
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Component ──────────────────────────────────────────────────────────────────
interface Props {
  venueCustomerId: string;
  onClose: () => void;
}

export default function ContactProfileDrawer({ venueCustomerId, onClose }: Props) {
  const [vc, setVc] = useState<VenueCustomer | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [inquiry, setInquiry] = useState<LeadInquiry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Notes
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Visible state for animation
  const [visible, setVisible] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Animate in
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  function close() {
    setVisible(false);
    setTimeout(onClose, 300);
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [vcRes, pipeRes, notesRes] = await Promise.all([
        fetch(`/api/venue-customers/${venueCustomerId}`, { cache: 'no-store' }),
        fetch('/api/pipelines', { cache: 'no-store' }),
        fetch(`/api/venue-customers/${venueCustomerId}/notes`),
      ]);
      if (!vcRes.ok) { setError('Contact not found'); return; }
      const vcData = (await vcRes.json()) as VenueCustomer;
      setVc(vcData);
      if (pipeRes.ok) {
        const pd = await pipeRes.json();
        setPipelines(Array.isArray(pd.pipelines) ? pd.pipelines : []);
      }
      if (notesRes.ok) setNotes(await notesRes.json());

      // Fetch inquiry details if there's a linked lead
      const linkedLeadId = vcData.pipeline_context?.linkedLeadId;
      if (linkedLeadId) {
        const leadRes = await fetch(`/api/leads/${linkedLeadId}`, { cache: 'no-store' });
        if (leadRes.ok) {
          const ld = await leadRes.json() as { lead?: { booking_timeline?: string | null; venue_matters?: string | null } };
          setInquiry({
            booking_timeline: ld.lead?.booking_timeline ?? null,
            venue_matters: ld.lead?.venue_matters ?? null,
          });
        }
      }
    } catch {
      setError('Failed to load contact');
    } finally {
      setLoading(false);
    }
  }, [venueCustomerId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Resolve pipeline / stage
  const currentStage = (() => {
    if (!vc || !pipelines.length) return null;
    const fallback = pipelines.find((p) => p.is_default) ?? pipelines[0];
    const pid = vc.pipeline_id ?? vc.pipeline_context?.pipelineId ?? fallback?.id;
    const pipe = pipelines.find((p) => p.id === pid) ?? fallback;
    const sid = vc.stage_id ?? vc.pipeline_context?.stageId ?? null;
    return pipe?.stages.find((s) => s.id === sid) ?? pipe?.stages[0] ?? null;
  })();

  async function addNote() {
    if (!newNote.trim() || !vc) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/venue-customers/${vc.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newNote.trim() }),
      });
      if (res.ok) {
        const note = await res.json() as Note;
        setNotes((n) => [note, ...n]);
        setNewNote('');
      }
    } finally {
      setSavingNote(false);
    }
  }

  const displayEmail = vc && !isPlaceholderEmail(vc.customer_email) ? vc.customer_email : null;
  const displayName = vc ? [vc.first_name, vc.last_name].filter(Boolean).join(' ') || 'Contact' : '';
  const initials = displayName ? displayName.charAt(0).toUpperCase() : '?';

  return (
    <>
      {/* Overlay */}
      <div
        ref={overlayRef}
        onClick={close}
        className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
        aria-hidden
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-label="Contact profile"
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300"
        style={{ transform: visible ? 'translateX(0)' : 'translateX(100%)' }}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Contact Profile</h2>
          <div className="flex items-center gap-2">
            {vc && (
              <Link
                href={`/dashboard/contacts/${venueCustomerId}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors"
              >
                Full profile <ExternalLink size={12} />
              </Link>
            )}
            <button
              onClick={close}
              className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={22} className="animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 py-20 text-center">
              <AlertCircle size={20} className="text-red-400" />
              <p className="text-sm text-gray-500">{error}</p>
            </div>
          ) : vc ? (
            <div className="divide-y divide-gray-100">

              {/* ── Hero ── */}
              <div className="px-5 py-5">
                <div className="flex items-start gap-4">
                  <div
                    className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full text-xl font-semibold text-white"
                    style={{ backgroundColor: '#1b1b1b' }}
                  >
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 leading-tight">{displayName}</h3>
                    {currentStage && (
                      <span
                        className="mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        style={{
                          backgroundColor: `${currentStage.color}22`,
                          color: currentStage.color,
                          border: `1px solid ${currentStage.color}44`,
                        }}
                      >
                        {currentStage.name}
                      </span>
                    )}
                    {vc.referral_source && (
                      <p className="mt-1 text-[11px] text-gray-400">via {vc.referral_source}</p>
                    )}
                  </div>
                </div>

                {/* SMS DND alert */}
                {vc.sms_dnd && (
                  <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                    <Smartphone size={13} className="shrink-0 text-amber-700" />
                    SMS Do Not Disturb is active for this contact.
                  </div>
                )}
              </div>

              {/* ── Contact Info ── */}
              <div className="px-5 py-4">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5">
                  <User size={11} /> Contact Info
                </p>
                <div className="space-y-2 text-sm text-gray-700">
                  {displayEmail ? (
                    <div className="flex items-center gap-2">
                      <Mail size={13} className="text-gray-400 flex-shrink-0" />
                      <span className="truncate">{displayEmail}</span>
                    </div>
                  ) : null}
                  {vc.phone ? (
                    <div className="flex items-center gap-2">
                      <Phone size={13} className="text-gray-400 flex-shrink-0" />
                      {vc.phone}
                    </div>
                  ) : null}
                  {!displayEmail && !vc.phone && (
                    <p className="text-xs text-gray-400">No contact info on file.</p>
                  )}
                </div>
              </div>

              {/* ── Partner ── */}
              {vc.partner_first_name && (
                <div className="px-5 py-4">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5">
                    <Heart size={11} /> Partner
                  </p>
                  <div className="space-y-2 text-sm text-gray-700">
                    <div className="flex items-center gap-2">
                      <User size={13} className="text-gray-400" />
                      {[vc.partner_first_name, vc.partner_last_name].filter(Boolean).join(' ')}
                    </div>
                    {vc.partner_email && (
                      <div className="flex items-center gap-2">
                        <Mail size={13} className="text-gray-400" />{vc.partner_email}
                      </div>
                    )}
                    {vc.partner_phone && (
                      <div className="flex items-center gap-2">
                        <Phone size={13} className="text-gray-400" />{vc.partner_phone}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Inquiry Questions ── */}
              {inquiry && (inquiry.booking_timeline || inquiry.venue_matters) && (
                <div className="px-5 py-4">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Inquiry Details
                  </p>
                  <div className="space-y-3 text-sm">
                    {inquiry.booking_timeline && (
                      <div>
                        <p className="text-[11px] text-gray-400 mb-0.5">Touring timeline</p>
                        <p className="text-gray-700">{inquiry.booking_timeline}</p>
                      </div>
                    )}
                    {inquiry.venue_matters && (
                      <div>
                        <p className="text-[11px] text-gray-400 mb-0.5">What matters most</p>
                        <p className="text-gray-700">{inquiry.venue_matters}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Wedding Details ── */}
              {(vc.wedding_date || vc.guest_count || vc.coordinator_name) && (
                <div className="px-5 py-4">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5">
                    <Calendar size={11} /> Event Details
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-gray-700">
                    {vc.wedding_date && (
                      <div>
                        <p className="text-[11px] text-gray-400">Wedding date</p>
                        <p>{fmtDate(vc.wedding_date)}</p>
                      </div>
                    )}
                    {vc.rehearsal_date && (
                      <div>
                        <p className="text-[11px] text-gray-400">Rehearsal</p>
                        <p>{fmtDate(vc.rehearsal_date)}</p>
                      </div>
                    )}
                    {vc.guest_count != null && (
                      <div>
                        <p className="text-[11px] text-gray-400">Guests</p>
                        <p>{vc.guest_count}</p>
                      </div>
                    )}
                    {vc.ceremony_type && (
                      <div>
                        <p className="text-[11px] text-gray-400">Ceremony</p>
                        <p className="capitalize">{vc.ceremony_type.replace(/_/g, ' ')}</p>
                      </div>
                    )}
                    {vc.coordinator_name && (
                      <div className="col-span-2">
                        <p className="text-[11px] text-gray-400">Coordinator</p>
                        <p>{vc.coordinator_name}{vc.coordinator_phone ? ` · ${vc.coordinator_phone}` : ''}</p>
                      </div>
                    )}
                    {vc.catering_notes && (
                      <div className="col-span-2">
                        <p className="text-[11px] text-gray-400">Catering notes</p>
                        <p className="text-xs leading-relaxed">{vc.catering_notes}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Notes ── */}
              <div className="px-5 py-4">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5">
                  <ClipboardList size={11} /> Notes {notes.length > 0 && `(${notes.length})`}
                </p>
                {/* Add note */}
                <div className="mb-4">
                  <div className="flex gap-2">
                    <textarea
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Add a note…"
                      rows={2}
                      className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void addNote();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void addNote()}
                      disabled={savingNote || !newNote.trim()}
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center self-start rounded-xl text-white transition-colors disabled:opacity-40"
                      style={{ backgroundColor: '#1b1b1b' }}
                      aria-label="Save note"
                    >
                      {savingNote ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    </button>
                  </div>
                </div>
                {/* Notes list */}
                {notes.length === 0 ? (
                  <p className="text-xs text-gray-400">No notes yet.</p>
                ) : (
                  <div className="space-y-3">
                    {notes.map((note) => (
                      <div key={note.id} className="rounded-xl bg-gray-50 px-3 py-2.5">
                        <p className="text-sm text-gray-800 whitespace-pre-line leading-relaxed">{note.content}</p>
                        <p className="mt-1.5 text-[10px] text-gray-400">
                          {note.author_name ? `${note.author_name} · ` : ''}{fmtDate(note.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Footer: full profile link ── */}
              <div className="px-5 py-4">
                <Link
                  href={`/dashboard/contacts/${venueCustomerId}`}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <Pencil size={14} />
                  Open full profile
                  <ChevronRight size={14} className="text-gray-400" />
                </Link>
              </div>

            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
