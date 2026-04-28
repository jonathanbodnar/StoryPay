'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  X, User, Mail, Phone, Heart, Calendar,
  ClipboardList, Loader2, ExternalLink, Pencil,
  ChevronRight, AlertCircle, Smartphone, Check,
  Activity, Receipt, FileCheck, Plus, Trash2,
  Upload, Undo2, ChevronDown, ChevronUp, Copy,
  RefreshCw, Info, CalendarPlus, Clock, MapPin,
} from 'lucide-react';
import { classNames, formatCents, formatDate, formatDateTime, getStatusColor } from '@/lib/utils';
import { slugifyStageLabel } from '@/lib/pipeline-stage-slug';

// ── Types ──────────────────────────────────────────────────────────────────────
interface VenueCustomer {
  id: string; first_name: string; last_name: string;
  customer_email: string; phone: string | null;
  sms_dnd?: boolean;
  partner_first_name: string | null; partner_last_name: string | null;
  partner_email: string | null; partner_phone: string | null;
  wedding_date: string | null; guest_count: number | null;
  ceremony_type: string | null; rehearsal_date: string | null;
  coordinator_name: string | null; coordinator_phone: string | null;
  catering_notes: string | null; referral_source: string | null;
  pipeline_stage: string; pipeline_id?: string | null; stage_id?: string | null;
  wedding_space_id?: string | null;
  venue_spaces?: { id: string; name: string; color: string } | null;
  pipeline_context?: { pipelineId: string; stageId: string; linkedLeadId: string | null } | null;
}
interface PipelineStage { id: string; name: string; color: string; position: number; }
interface Pipeline { id: string; name: string; is_default: boolean; stages: PipelineStage[]; }
interface Note { id: string; content: string; author_name: string | null; created_at: string; }
interface Task { id: string; title: string; due_date: string | null; completed_at: string | null; created_at: string; }
interface ActivityEntry { id: string; activity_type: string; title: string; description: string | null; created_at: string; }
interface Proposal {
  id: string; customer_name: string; customer_email: string; status: string;
  price: number; payment_type: string; payment_config: Record<string, unknown> | null;
  public_token: string; charge_id?: string | null;
  sent_at: string | null; signed_at: string | null; paid_at: string | null; created_at: string;
}
interface FileRow {
  id: string; filename: string; file_type: string; file_status: string;
  file_size: number | null; uploaded_by: string | null; created_at: string; url: string | null;
}
interface LeadInquiry { booking_timeline: string | null; venue_matters: string | null; }
interface Appointment {
  id: string; title: string; event_type: string;
  start_at: string; end_at: string; all_day: boolean;
  notes: string | null; status: string;
  venue_spaces: { id: string; name: string; color: string } | null;
}

const APPOINTMENT_EVENT_TYPES = [
  { value: 'tour',       label: 'Tour' },
  { value: 'meeting',    label: 'Meeting' },
  { value: 'phone_call', label: 'Phone Call' },
  { value: 'tasting',    label: 'Tasting' },
  { value: 'rehearsal',  label: 'Rehearsal' },
  { value: 'wedding',    label: 'Wedding' },
  { value: 'reception',  label: 'Reception' },
  { value: 'other',      label: 'Other' },
];

const CEREMONY_TYPES = [
  { value: 'ceremony_only', label: 'Ceremony Only' },
  { value: 'reception_only', label: 'Reception Only' },
  { value: 'ceremony_reception', label: 'Ceremony & Reception' },
];
const REFERRAL_SOURCES = ['Instagram','Google','Wedding Wire','The Knot','Referral','Venue Website','Facebook','Other'];
const FILE_TYPES    = ['contract','floor_plan','vendor_agreement','insurance','photo','other'];
const FILE_STATUSES = ['pending','received','approved'];
const FILE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700', received: 'bg-blue-100 text-blue-700', approved: 'bg-emerald-100 text-emerald-700',
};
const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  proposal_sent: <FileCheck size={12} />, proposal_viewed: <ExternalLink size={12} />,
  proposal_signed: <FileCheck size={12} />, payment_made: <Receipt size={12} />,
  note_added: <ClipboardList size={12} />, file_uploaded: <Upload size={12} />,
  task_created: <Plus size={12} />, task_completed: <Check size={12} />,
  event_created: <Calendar size={12} />, stage_changed: <Activity size={12} />,
};

type DrawerTab = 'overview' | 'notes' | 'activity' | 'payments' | 'tasks' | 'documents' | 'schedule';

function isPlaceholderEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return !e || !e.includes('@') || e.endsWith('@storypay.internal') || e.includes('@ghl-sms.storypay.placeholder');
}

// ── Module-level cache so reopening a drawer for the same contact is instant.
// Entries are kept in memory for the life of the page session. We always
// background-refresh on open, so the cache is just for paint speed.
interface DrawerCacheEntry {
  vc: VenueCustomer | null;
  pipelines: Pipeline[];
  notes: Note[];
  tasks: Task[];
  activity: ActivityEntry[];
  spaces: { id: string; name: string; color: string; capacity?: number | null }[];
  inquiry: LeadInquiry | null;
  proposals: Proposal[];
  files: FileRow[];
  appointments: Appointment[];
  loadedPayments: boolean;
  loadedDocs: boolean;
  loadedAppts: boolean;
}
const DRAWER_CACHE = new Map<string, DrawerCacheEntry>();

// ── ApptCard helper ───────────────────────────────────────────────────────────
function ApptCard({ appt, onCancel, past }: { appt: Appointment; onCancel?: () => void; past?: boolean }) {
  const start = new Date(appt.start_at);
  const end   = new Date(appt.end_at);
  const dateStr = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = appt.all_day ? 'All day'
    : `${start.toLocaleTimeString(undefined, {hour:'numeric',minute:'2-digit'})} – ${end.toLocaleTimeString(undefined, {hour:'numeric',minute:'2-digit'})}`;
  const typeLabel = appt.event_type.replace(/_/g,' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3 group">
      <div className="flex-shrink-0 flex flex-col items-center justify-center w-10 text-center">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{start.toLocaleDateString(undefined,{month:'short'})}</span>
        <span className="text-xl font-bold text-gray-900 leading-none">{start.getDate()}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900 truncate">{appt.title}</p>
        <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-gray-500">
          <span className="flex items-center gap-1"><Clock size={11}/>{timeStr}</span>
          {appt.venue_spaces && <span className="flex items-center gap-1"><MapPin size={11}/>{appt.venue_spaces.name}</span>}
          <span className="rounded-full border border-gray-200 px-1.5 py-0">{typeLabel}</span>
        </div>
        {appt.notes && <p className="mt-1 text-[11px] text-gray-400 truncate">{appt.notes}</p>}
      </div>
      {!past && onCancel && (
        <button type="button" onClick={onCancel} title="Cancel appointment"
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 text-gray-300 hover:text-red-500">
          <Trash2 size={13}/>
        </button>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────
export interface InitialContact {
  id: string;
  first_name: string;
  last_name: string | null;
  customer_email: string | null;
  phone: string | null;
  contact_stage?: { name: string; color: string | null } | null;
}

interface Props {
  venueCustomerId: string;
  onClose: () => void;
  /** Optional initial contact data so the drawer can render the hero
   * instantly without waiting for the API round-trip. */
  initialContact?: InitialContact | null;
}

export default function ContactProfileDrawer({ venueCustomerId, onClose, initialContact }: Props) {
  // Read cache (if previously opened for this contact in this session).
  const cached = DRAWER_CACHE.get(venueCustomerId);

  // Build a stub VenueCustomer so the UI ALWAYS paints instantly. Prefer
  // cached → initialContact → minimal placeholder. The fields that aren't
  // in initialContact stay null/empty until the API resolves.
  const buildStub = (): VenueCustomer => {
    const base: VenueCustomer = {
      id: venueCustomerId,
      first_name: '', last_name: '',
      customer_email: '', phone: null,
      sms_dnd: false,
      partner_first_name: null, partner_last_name: null,
      partner_email: null, partner_phone: null,
      wedding_date: null, guest_count: null,
      ceremony_type: null, rehearsal_date: null,
      coordinator_name: null, coordinator_phone: null,
      catering_notes: null, referral_source: null,
      pipeline_stage: '', pipeline_id: null, stage_id: null,
      wedding_space_id: null, venue_spaces: null, pipeline_context: null,
    };
    if (initialContact) {
      base.first_name = initialContact.first_name ?? '';
      base.last_name  = initialContact.last_name  ?? '';
      base.customer_email = initialContact.customer_email ?? '';
      base.phone = initialContact.phone;
    }
    return base;
  };

  const [vc, setVc] = useState<VenueCustomer | null>(cached?.vc ?? buildStub());
  const [pipelines, setPipelines] = useState<Pipeline[]>(cached?.pipelines ?? []);
  const [coreError, setCoreError] = useState('');

  // Secondary (loaded in background after core)
  const [notes, setNotes] = useState<Note[]>(cached?.notes ?? []);
  const [tasks, setTasks] = useState<Task[]>(cached?.tasks ?? []);
  const [activity, setActivity] = useState<ActivityEntry[]>(cached?.activity ?? []);
  const [inquiry, setInquiry] = useState<LeadInquiry | null>(cached?.inquiry ?? null);
  const [spaces, setSpaces] = useState<{ id: string; name: string; color: string; capacity?: number | null }[]>(cached?.spaces ?? []);

  // On-demand (loaded only when Payments/Documents tab opened)
  const [proposals, setProposals] = useState<Proposal[]>(cached?.proposals ?? []);
  const [files, setFiles] = useState<FileRow[]>(cached?.files ?? []);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const loadedPayments = useRef(cached?.loadedPayments ?? false);
  const loadedDocs = useRef(cached?.loadedDocs ?? false);

  // Schedule tab
  const [appointments, setAppointments] = useState<Appointment[]>(cached?.appointments ?? []);
  const [loadingAppts, setLoadingAppts] = useState(false);
  const loadedAppts = useRef(cached?.loadedAppts ?? false);
  const [showApptForm, setShowApptForm] = useState(false);
  const [apptForm, setApptForm] = useState({ title: '', event_type: 'tour', date: '', start_time: '09:00', end_time: '10:00', space_id: '', notes: '' });
  const [savingAppt, setSavingAppt] = useState(false);
  const [apptError, setApptError] = useState('');
  const [apptConflict, setApptConflict] = useState<{ title: string; start_at: string }[] | null>(null);

  const [activeTab, setActiveTab] = useState<DrawerTab>('overview');
  const [visible, setVisible] = useState(false);
  const [pipelineActionError, setPipelineActionError] = useState('');

  // Edit states
  const [editingContact, setEditingContact] = useState(false);
  const [editForm, setEditForm] = useState({ first_name: '', last_name: '', customer_email: '', phone: '' });
  const [savingContact, setSavingContact] = useState(false);
  const [contactError, setContactError] = useState('');

  const [editingPartner, setEditingPartner] = useState(false);
  const [partnerForm, setPartnerForm] = useState({ partner_first_name: '', partner_last_name: '', partner_email: '', partner_phone: '', referral_source: '' });
  const [savingPartner, setSavingPartner] = useState(false);
  const [partnerError, setPartnerError] = useState('');

  const [editingWedding, setEditingWedding] = useState(false);
  const [weddingForm, setWeddingForm] = useState({ wedding_date: '', rehearsal_date: '', guest_count: '', coordinator_name: '', coordinator_phone: '', ceremony_type: '', wedding_space_id: '', catering_notes: '' });
  const [savingWedding, setSavingWedding] = useState(false);
  const [weddingError, setWeddingError] = useState('');

  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteContent, setEditNoteContent] = useState('');
  const [savingEditNote, setSavingEditNote] = useState(false);

  const [newTask, setNewTask] = useState('');
  const [newTaskDue, setNewTaskDue] = useState('');
  const [savingTask, setSavingTask] = useState(false);
  const [taskError, setTaskError] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState('');
  const [editTaskDue, setEditTaskDue] = useState('');
  const [savingEditTask, setSavingEditTask] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState('contract');
  const [uploadError, setUploadError] = useState('');

  const [proposalSearch, setProposalSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Animate in
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);
  function close() { setVisible(false); setTimeout(onClose, 300); }
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Phase 1: critical path (renders immediately) ───────────────────────────
  // Fetches the canonical venue-customer record. Pipelines fetched in parallel
  // because Overview tab can render fully without them — the stage selector is
  // the only thing that depends on them, and it has its own subtle skeleton.
  const fetchCore = useCallback(async () => {
    setCoreError('');
    try {
      const vcRes = await fetch(`/api/venue-customers/${venueCustomerId}`, { cache: 'no-store' });
      if (!vcRes.ok) { setCoreError('Could not refresh contact details'); return null; }
      const vcData = await vcRes.json() as VenueCustomer;
      setVc(vcData);
      return vcData;
    } catch {
      setCoreError('Could not refresh contact details');
      return null;
    }
  }, [venueCustomerId]);

  // ── Phase 2: background secondary data (doesn't block UI, fully parallel) ──
  const fetchSecondary = useCallback(() => {
    // Each fetch resolves independently and updates its own slice of state.
    fetch('/api/pipelines', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((pd) => { if (pd) setPipelines(Array.isArray(pd.pipelines) ? pd.pipelines : []); })
      .catch(() => {});
    fetch(`/api/venue-customers/${venueCustomerId}/notes`)
      .then((r) => r.ok ? r.json() : null).then((d) => { if (d) setNotes(d); }).catch(() => {});
    fetch(`/api/venue-customers/${venueCustomerId}/tasks`)
      .then((r) => r.ok ? r.json() : null).then((d) => { if (d) setTasks(d); }).catch(() => {});
    fetch(`/api/venue-customers/${venueCustomerId}/activity`)
      .then((r) => r.ok ? r.json() : null).then((d) => { if (d) setActivity(d); }).catch(() => {});
    fetch('/api/spaces')
      .then((r) => r.ok ? r.json() : null).then((d) => { if (d) setSpaces(d); }).catch(() => {});
  }, [venueCustomerId]);

  // Inquiry fetch needs the linkedLeadId from vc — runs separately when vc resolves
  const fetchInquiry = useCallback((vcData: VenueCustomer | null) => {
    const linkedLeadId = vcData?.pipeline_context?.linkedLeadId;
    if (!linkedLeadId) return;
    fetch(`/api/leads/${linkedLeadId}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((ld: { lead?: { booking_timeline?: string | null; venue_matters?: string | null } } | null) => {
        if (ld?.lead) setInquiry({ booking_timeline: ld.lead.booking_timeline ?? null, venue_matters: ld.lead.venue_matters ?? null });
      })
      .catch(() => {});
  }, []);

  // ── Phase 3: on-demand (Payments / Documents tabs) ─────────────────────────
  const fetchPayments = useCallback(async (vcData: VenueCustomer) => {
    if (loadedPayments.current) return;
    loadedPayments.current = true;
    setLoadingPayments(true);
    try {
      const email = vcData.customer_email;
      if (email && !isPlaceholderEmail(email)) {
        const pRes = await fetch(`/api/customers?email=${encodeURIComponent(email)}`);
        if (pRes.ok) {
          const pd = await pRes.json();
          if (Array.isArray(pd.proposals)) { setProposals(pd.proposals); }
          else if (pd.customer?.id) {
            const custRes = await fetch(`/api/customers/${pd.customer.id}`);
            if (custRes.ok) { const cd = await custRes.json(); setProposals(cd.proposals || []); }
          }
        }
      }
    } finally { setLoadingPayments(false); }
  }, []);

  const fetchDocs = useCallback(async () => {
    if (loadedDocs.current) return;
    loadedDocs.current = true;
    setLoadingDocs(true);
    try {
      const res = await fetch(`/api/venue-customers/${venueCustomerId}/files`);
      if (res.ok) setFiles(await res.json());
    } finally { setLoadingDocs(false); }
  }, [venueCustomerId]);

  const fetchAppointments = useCallback(async () => {
    if (loadedAppts.current) return;
    loadedAppts.current = true;
    setLoadingAppts(true);
    try {
      const res = await fetch(`/api/venue-customers/${venueCustomerId}/appointments`);
      if (res.ok) setAppointments(await res.json());
    } finally { setLoadingAppts(false); }
  }, [venueCustomerId]);

  // On mount: fire ALL fetches in parallel. Hero is already painted from
  // cache or initialContact stub, so nothing is blocking the UI.
  useEffect(() => {
    fetchSecondary();
    void fetchCore().then((vcData) => fetchInquiry(vcData));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueCustomerId]);

  // Persist current state to module cache so reopens are instant.
  useEffect(() => {
    DRAWER_CACHE.set(venueCustomerId, {
      vc, pipelines, notes, tasks, activity, spaces, inquiry, proposals, files, appointments,
      loadedPayments: loadedPayments.current,
      loadedDocs: loadedDocs.current,
      loadedAppts: loadedAppts.current,
    });
  }, [venueCustomerId, vc, pipelines, notes, tasks, activity, spaces, inquiry, proposals, files, appointments]);

  // When tab changes, load on-demand data
  useEffect(() => {
    if (activeTab === 'payments' && vc && !loadedPayments.current) void fetchPayments(vc);
    if (activeTab === 'documents' && !loadedDocs.current) void fetchDocs();
    if (activeTab === 'schedule' && !loadedAppts.current) void fetchAppointments();
  }, [activeTab, vc, fetchPayments, fetchDocs, fetchAppointments]);

  // ── Pipeline ───────────────────────────────────────────────────────────────
  const pipelineUi = useMemo(() => {
    if (!vc || !pipelines.length) return { safePipelineId: '', activeStages: [], resolvedStageId: null, currentStageMeta: undefined };
    const fallback = pipelines.find((p) => p.is_default) ?? pipelines[0];
    const rawPid = vc.pipeline_id ?? vc.pipeline_context?.pipelineId ?? fallback?.id ?? '';
    const safePipelineId = (pipelines.some((p) => p.id === rawPid) ? rawPid : (fallback?.id ?? ''));
    const activePipe = pipelines.find((p) => p.id === safePipelineId) ?? fallback;
    const activeStages = activePipe?.stages ?? [];
    const rawSid = vc.stage_id ?? vc.pipeline_context?.stageId ?? null;
    const resolvedStageId = rawSid && activeStages.some((s) => s.id === rawSid) ? rawSid : (activeStages[0]?.id ?? null);
    return { safePipelineId, activeStages, resolvedStageId, currentStageMeta: resolvedStageId ? activeStages.find((s) => s.id === resolvedStageId) : undefined };
  }, [vc, pipelines]);

  async function applyStage(stageId: string) {
    if (!vc) return;
    setPipelineActionError('');
    const stageRow = pipelineUi.activeStages.find((s) => s.id === stageId);
    const slug = stageRow ? slugifyStageLabel(stageRow.name) : vc.pipeline_stage;
    setVc((v) => v ? { ...v, stage_id: stageId, pipeline_stage: slug } : v);
    const res = await fetch(`/api/venue-customers/${vc.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelineId: pipelineUi.safePipelineId, stageId }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setPipelineActionError((d as { error?: string }).error || 'Could not update.'); }
  }

  // ── Mutations ──────────────────────────────────────────────────────────────
  async function saveContact() {
    if (!editForm.first_name.trim()) { setContactError('First name is required'); return; }
    setSavingContact(true); setContactError('');
    const res = await fetch(`/api/venue-customers/${venueCustomerId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm) });
    if (res.ok) { setVc(await res.json()); setEditingContact(false); }
    else { const d = await res.json().catch(() => ({})); setContactError((d as { error?: string }).error || 'Failed to save'); }
    setSavingContact(false);
  }
  async function savePartner() {
    setSavingPartner(true); setPartnerError('');
    const res = await fetch(`/api/venue-customers/${venueCustomerId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(partnerForm) });
    if (res.ok) { setVc(await res.json()); setEditingPartner(false); }
    else { const d = await res.json().catch(() => ({})); setPartnerError((d as { error?: string }).error || 'Failed to save'); }
    setSavingPartner(false);
  }
  async function saveWedding() {
    if (!vc) return;
    setSavingWedding(true); setWeddingError('');
    const payload = { ...weddingForm, guest_count: weddingForm.guest_count ? parseInt(weddingForm.guest_count, 10) : null, wedding_date: weddingForm.wedding_date || null, rehearsal_date: weddingForm.rehearsal_date || null, coordinator_name: weddingForm.coordinator_name || null, coordinator_phone: weddingForm.coordinator_phone || null, ceremony_type: weddingForm.ceremony_type || null, wedding_space_id: weddingForm.wedding_space_id || null, catering_notes: weddingForm.catering_notes || null };
    const res = await fetch(`/api/venue-customers/${venueCustomerId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) { setVc(await res.json()); setEditingWedding(false); }
    else { const d = await res.json().catch(() => ({})); setWeddingError((d as { error?: string }).error || 'Failed to save'); }
    setSavingWedding(false);
  }
  async function addNote() {
    if (!newNote.trim()) return;
    setSavingNote(true); setNoteError('');
    const res = await fetch(`/api/venue-customers/${venueCustomerId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: newNote.trim() }) });
    if (res.ok) { const note = await res.json(); setNotes((p) => [note, ...p]); setNewNote(''); }
    else { const d = await res.json().catch(() => ({})); setNoteError((d as { error?: string }).error || 'Failed to save'); }
    setSavingNote(false);
  }
  async function deleteNote(id: string) {
    await fetch(`/api/venue-customers/${venueCustomerId}/notes?noteId=${id}`, { method: 'DELETE' });
    setNotes((p) => p.filter((n) => n.id !== id));
  }
  async function saveEditNote() {
    if (!editingNoteId || !editNoteContent.trim()) return;
    setSavingEditNote(true);
    const res = await fetch(`/api/venue-customers/${venueCustomerId}/notes`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteId: editingNoteId, content: editNoteContent.trim() }) });
    if (res.ok) { const u = await res.json(); setNotes((p) => p.map((n) => n.id === editingNoteId ? { ...n, content: u.content ?? editNoteContent.trim() } : n)); setEditingNoteId(null); setEditNoteContent(''); }
    setSavingEditNote(false);
  }
  async function addTask() {
    if (!newTask.trim()) return;
    setSavingTask(true); setTaskError('');
    const res = await fetch(`/api/venue-customers/${venueCustomerId}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newTask.trim(), due_date: newTaskDue || null }) });
    if (res.ok) { const task = await res.json(); setTasks((p) => [...p, task]); setNewTask(''); setNewTaskDue(''); }
    else { const d = await res.json().catch(() => ({})); setTaskError((d as { error?: string }).error || 'Failed'); }
    setSavingTask(false);
  }
  async function toggleTask(t: Task) {
    const completed_at = t.completed_at ? null : new Date().toISOString();
    const res = await fetch(`/api/venue-customers/${venueCustomerId}/tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed_at }) });
    if (res.ok) setTasks((p) => p.map((x) => x.id === t.id ? { ...x, completed_at } : x));
  }
  async function deleteTask(id: string) {
    await fetch(`/api/venue-customers/${venueCustomerId}/tasks/${id}`, { method: 'DELETE' });
    setTasks((p) => p.filter((t) => t.id !== id));
  }
  async function saveEditTask() {
    if (!editingTaskId || !editTaskTitle.trim()) return;
    setSavingEditTask(true);
    const res = await fetch(`/api/venue-customers/${venueCustomerId}/tasks/${editingTaskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: editTaskTitle.trim(), due_date: editTaskDue || null }) });
    if (res.ok) { setTasks((p) => p.map((t) => t.id === editingTaskId ? { ...t, title: editTaskTitle.trim(), due_date: editTaskDue || null } : t)); setEditingTaskId(null); setEditTaskTitle(''); setEditTaskDue(''); }
    setSavingEditTask(false);
  }
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true); setUploadError('');
    const fd = new FormData(); fd.append('file', file); fd.append('file_type', uploadType);
    const res = await fetch(`/api/venue-customers/${venueCustomerId}/files`, { method: 'POST', body: fd });
    if (res.ok) { const f = await res.json(); setFiles((p) => [f, ...p]); }
    else { const d = await res.json().catch(() => ({})); setUploadError((d as { error?: string }).error || 'Upload failed'); }
    e.target.value = ''; setUploading(false);
  }
  async function updateFileStatus(fileId: string, file_status: string) {
    const res = await fetch(`/api/venue-customers/${venueCustomerId}/files`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId, file_status }) });
    if (res.ok) { const f = await res.json(); setFiles((p) => p.map((x) => x.id === f.id ? { ...x, ...f } : x)); }
  }
  async function deleteFile(fileId: string) {
    await fetch(`/api/venue-customers/${venueCustomerId}/files?fileId=${fileId}`, { method: 'DELETE' });
    setFiles((p) => p.filter((f) => f.id !== fileId));
  }
  async function saveAppointment(forceConflict = false) {
    if (!apptForm.date || !apptForm.start_time || !apptForm.end_time) { setApptError('Date and times are required'); return; }
    setSavingAppt(true); setApptError(''); setApptConflict(null);
    const start_at = `${apptForm.date}T${apptForm.start_time}:00`;
    const end_at   = `${apptForm.date}T${apptForm.end_time}:00`;
    if (new Date(end_at) <= new Date(start_at)) { setApptError('End time must be after start time'); setSavingAppt(false); return; }
    const payload: Record<string, unknown> = {
      title:      apptForm.title.trim() || undefined,
      event_type: apptForm.event_type,
      start_at, end_at,
      space_id:   apptForm.space_id || null,
      notes:      apptForm.notes.trim() || null,
    };
    if (forceConflict) payload.override_conflict = true;
    const res = await fetch(`/api/venue-customers/${venueCustomerId}/appointments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      setApptConflict((data as { conflicts?: { title: string; start_at: string }[] }).conflicts ?? []);
      setSavingAppt(false); return;
    }
    if (!res.ok) { setApptError((data as { error?: string }).error || 'Failed to save'); setSavingAppt(false); return; }
    setAppointments((p) => [...p, data as Appointment].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()));
    setShowApptForm(false);
    setApptForm({ title: '', event_type: 'tour', date: '', start_time: '09:00', end_time: '10:00', space_id: '', notes: '' });
    setSavingAppt(false);
  }

  async function cancelAppointment(eventId: string) {
    await fetch(`/api/venue-customers/${venueCustomerId}/appointments?eventId=${eventId}`, { method: 'DELETE' });
    setAppointments((p) => p.filter((a) => a.id !== eventId));
  }

  function copyLink(p: Proposal) {
    void navigator.clipboard.writeText(`${window.location.origin}/proposal/${p.public_token}`);
    setCopiedId(p.id); setTimeout(() => setCopiedId(null), 2000);
  }
  async function handleResend(p: Proposal) {
    setResendingId(p.id);
    await fetch(`/api/proposals/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sendNow: true }) });
    setResendingId(null);
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const openTasks = tasks.filter((t) => !t.completed_at);
  const completedTasks = tasks.filter((t) => !!t.completed_at);
  const totalPaid = proposals.filter((p) => p.status === 'paid').reduce((s, p) => s + (p.price || 0), 0);
  const totalPending = proposals.filter((p) => ['sent','opened','signed'].includes(p.status)).reduce((s, p) => s + (p.price || 0), 0);
  const displayEmail = vc && !isPlaceholderEmail(vc.customer_email) ? vc.customer_email : null;
  const displayName = vc
    ? [vc.first_name, vc.last_name].filter(Boolean).join(' ').trim() || vc.customer_email || 'Loading…'
    : 'Loading…';
  const initials = displayName.charAt(0).toUpperCase() || '?';

  function EditFooter({ onCancel, onSave, saving, err }: { onCancel: () => void; onSave: () => void; saving: boolean; err: string }) {
    return (
      <div className="flex flex-col gap-1.5 pt-1">
        {err && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={12}/>{err}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button type="button" onClick={onSave} disabled={saving} className="flex-1 rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-50" style={{backgroundColor:'#1b1b1b'}}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  const upcomingAppts = appointments.filter((a) => new Date(a.end_at) >= new Date());

  const tabs: { id: DrawerTab; label: string; count?: number; icon?: React.ReactNode }[] = [
    { id: 'overview',  label: 'Overview' },
    { id: 'notes',     label: 'Notes',    count: notes.length || undefined },
    { id: 'activity',  label: 'Activity' },
    { id: 'payments',  label: 'Payments', count: proposals.length || undefined },
    { id: 'tasks',     label: 'Tasks',    count: openTasks.length || undefined },
    { id: 'documents', label: 'Docs',     count: files.length || undefined },
    { id: 'schedule',  label: 'Schedule', count: upcomingAppts.length || undefined, icon: <Calendar size={12}/> },
  ];

  return (
    <>
      <div onClick={close} className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-300" style={{opacity: visible ? 1 : 0}} aria-hidden />
      <div role="dialog" aria-label="Contact profile"
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300"
        style={{transform: visible ? 'translateX(0)' : 'translateX(100%)'}}>

        {/* Top bar */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Contact Profile</h2>
          <div className="flex items-center gap-3">
            {vc && <Link href={`/dashboard/contacts/${venueCustomerId}`} className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors">Full page <ExternalLink size={12}/></Link>}
            <button onClick={close} className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100" aria-label="Close"><X size={16}/></button>
          </div>
        </div>

        {/* Hard error only: if the contact record cannot be loaded at all,
            show an inline error banner above the still-rendered body. */}
        {coreError && (
          <div className="flex-shrink-0 bg-red-50 border-b border-red-100 px-5 py-2 flex items-center gap-2">
            <AlertCircle size={14} className="text-red-500"/>
            <p className="text-xs text-red-700">{coreError}</p>
          </div>
        )}
        {vc ? (
          <div className="flex min-h-0 flex-1 flex-col">

            {/* Hero */}
            <div className="flex-shrink-0 border-b border-gray-100 px-5 py-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-xl font-semibold text-white" style={{backgroundColor:'#1b1b1b'}}>{initials}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-900 leading-tight">{displayName}</h3>
                    {pipelineUi.currentStageMeta ? (
                      <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{backgroundColor:`${pipelineUi.currentStageMeta.color}22`,color:pipelineUi.currentStageMeta.color,border:`1px solid ${pipelineUi.currentStageMeta.color}44`}}>
                        {pipelineUi.currentStageMeta.name}
                      </span>
                    ) : initialContact?.contact_stage?.name ? (
                      <span
                        className="rounded-full px-2.5 py-0.5 text-xs font-semibold border"
                        style={initialContact.contact_stage.color ? {
                          backgroundColor: `${initialContact.contact_stage.color}22`,
                          color: initialContact.contact_stage.color,
                          borderColor: `${initialContact.contact_stage.color}44`,
                        } : { borderColor: '#e5e7eb', color: '#374151', backgroundColor: '#f9fafb' }}
                      >
                        {initialContact.contact_stage.name}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-sm text-gray-500">
                    {displayEmail && <span className="flex items-center gap-1"><Mail size={12}/>{displayEmail}</span>}
                    {vc.phone && <span className="flex items-center gap-1"><Phone size={12}/>{vc.phone}</span>}
                    {vc.referral_source && <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs">via {vc.referral_source}</span>}
                  </div>
                </div>
              </div>

              {/* KPI strip */}
              <div className="mt-4 grid grid-cols-4 divide-x divide-gray-100 rounded-xl border border-gray-100 bg-gray-50/60">
                {[
                  {label:'Proposals', value: proposals.length, color:'text-gray-900'},
                  {label:'Paid',      value: formatCents(totalPaid),    color:'text-emerald-600'},
                  {label:'Pending',   value: formatCents(totalPending), color:'text-amber-600'},
                  {label:'Tasks',     value: openTasks.length, color: openTasks.length > 0 ? 'text-orange-600' : 'text-gray-900'},
                ].map((k) => (
                  <div key={k.label} className="px-3 py-2 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{k.label}</p>
                    <p className={`mt-0.5 text-base font-bold ${k.color}`}>{k.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Stage selector */}
            {pipelineUi.activeStages.length > 0 && (
              <div className="flex-shrink-0 border-b border-gray-100 px-5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mr-1">Stage</span>
                  {pipelineUi.activeStages.map((st) => {
                    const active = pipelineUi.resolvedStageId === st.id;
                    return (
                      <button key={st.id} type="button" onClick={() => void applyStage(st.id)}
                        className="rounded-full px-2.5 py-1 text-xs font-medium border transition-colors"
                        style={active ? {backgroundColor:`${st.color}22`,color:st.color,borderColor:`${st.color}55`} : {borderColor:'#e5e7eb',color:'#6b7280'}}>
                        {st.name}
                      </button>
                    );
                  })}
                </div>
                {pipelineActionError && <p className="mt-1 text-xs text-red-600">{pipelineActionError}</p>}
              </div>
            )}

            {/* Tabs */}
            <div className="flex flex-shrink-0 overflow-x-auto border-b border-gray-200">
              {tabs.map((t) => (
                <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
                  className={classNames('flex-shrink-0 inline-flex items-center gap-1 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap',
                    activeTab === t.id ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700')}>
                  {t.icon}{t.label}{t.count != null ? ` (${t.count})` : ''}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">

              {/* OVERVIEW */}
              {activeTab === 'overview' && (
                <div className="space-y-5">
                  {vc.sms_dnd && (
                    <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                      <Smartphone size={13} className="shrink-0 text-amber-700"/>SMS Do Not Disturb is active.
                    </div>
                  )}

                  {/* Contact info */}
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5"><User size={14}/>Contact Info</h4>
                      {!editingContact && <button onClick={() => {setEditForm({first_name:vc.first_name,last_name:vc.last_name||'',customer_email:displayEmail||'',phone:vc.phone||''});setContactError('');setEditingContact(true);}} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"><Pencil size={11}/>Edit</button>}
                    </div>
                    {editingContact ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          {([{k:'first_name',l:'First Name'},{k:'last_name',l:'Last Name'}] as const).map((f) => (
                            <div key={f.k}><label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{f.l}</label>
                              <input value={editForm[f.k]} onChange={(e)=>setEditForm((p)=>({...p,[f.k]:e.target.value}))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"/></div>
                          ))}
                        </div>
                        {([{k:'customer_email',l:'Email',t:'email'},{k:'phone',l:'Phone',t:'tel'}] as const).map((f) => (
                          <div key={f.k}><label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{f.l}</label>
                            <input type={f.t} value={editForm[f.k]} onChange={(e)=>setEditForm((p)=>({...p,[f.k]:e.target.value}))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"/></div>
                        ))}
                        <EditFooter onCancel={()=>setEditingContact(false)} onSave={()=>void saveContact()} saving={savingContact} err={contactError}/>
                      </div>
                    ) : (
                      <div className="space-y-2 text-sm text-gray-700">
                        {displayEmail && <div className="flex items-center gap-2"><Mail size={13} className="text-gray-400"/>{displayEmail}</div>}
                        {vc.phone && <div className="flex items-center gap-2"><Phone size={13} className="text-gray-400"/>{vc.phone}</div>}
                        {!displayEmail && !vc.phone && <p className="text-xs text-gray-400">No contact info on file.</p>}
                      </div>
                    )}
                  </div>

                  {/* Partner */}
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5"><Heart size={14}/>Partner</h4>
                      {!editingPartner && <button onClick={()=>{setPartnerForm({partner_first_name:vc.partner_first_name||'',partner_last_name:vc.partner_last_name||'',partner_email:vc.partner_email||'',partner_phone:vc.partner_phone||'',referral_source:vc.referral_source||''});setPartnerError('');setEditingPartner(true);}} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"><Pencil size={11}/>{vc.partner_first_name?'Edit':'Add'}</button>}
                    </div>
                    {editingPartner ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          {([{k:'partner_first_name',l:'First Name'},{k:'partner_last_name',l:'Last Name'}] as const).map((f)=>(
                            <div key={f.k}><label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{f.l}</label>
                              <input value={partnerForm[f.k]} onChange={(e)=>setPartnerForm((p)=>({...p,[f.k]:e.target.value}))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"/></div>
                          ))}
                        </div>
                        {([{k:'partner_email',l:'Email',t:'email'},{k:'partner_phone',l:'Phone',t:'tel'}] as const).map((f)=>(
                          <div key={f.k}><label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{f.l}</label>
                            <input type={f.t} value={partnerForm[f.k]} onChange={(e)=>setPartnerForm((p)=>({...p,[f.k]:e.target.value}))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"/></div>
                        ))}
                        <div><label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Referral Source</label>
                          <select value={partnerForm.referral_source} onChange={(e)=>setPartnerForm((p)=>({...p,referral_source:e.target.value}))} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none">
                            <option value="">Unknown</option>{REFERRAL_SOURCES.map((s)=><option key={s} value={s}>{s}</option>)}
                          </select></div>
                        <EditFooter onCancel={()=>setEditingPartner(false)} onSave={()=>void savePartner()} saving={savingPartner} err={partnerError}/>
                      </div>
                    ) : vc.partner_first_name ? (
                      <div className="space-y-2 text-sm text-gray-700">
                        <div className="flex items-center gap-2"><User size={13} className="text-gray-400"/>{[vc.partner_first_name,vc.partner_last_name].filter(Boolean).join(' ')}</div>
                        {vc.partner_email && <div className="flex items-center gap-2"><Mail size={13} className="text-gray-400"/>{vc.partner_email}</div>}
                        {vc.partner_phone && <div className="flex items-center gap-2"><Phone size={13} className="text-gray-400"/>{vc.partner_phone}</div>}
                      </div>
                    ) : <p className="text-xs text-gray-400">No partner info yet.</p>}
                  </div>

                  {/* Inquiry */}
                  {inquiry && (inquiry.booking_timeline || inquiry.venue_matters) && (
                    <div className="rounded-xl border border-gray-200 bg-white p-4">
                      <h4 className="mb-3 text-sm font-semibold text-gray-900">Inquiry Questions</h4>
                      <div className="space-y-3 text-sm">
                        {inquiry.booking_timeline && <div><p className="text-[11px] text-gray-400 mb-0.5">Touring timeline</p><p className="text-gray-700">{inquiry.booking_timeline}</p></div>}
                        {inquiry.venue_matters && <div><p className="text-[11px] text-gray-400 mb-0.5">What matters most</p><p className="text-gray-700">{inquiry.venue_matters}</p></div>}
                      </div>
                    </div>
                  )}

                  {/* Event details */}
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5"><Calendar size={14}/>Event Details</h4>
                      {!editingWedding && <button onClick={()=>{setWeddingForm({wedding_date:vc.wedding_date||'',rehearsal_date:vc.rehearsal_date||'',guest_count:vc.guest_count!=null?String(vc.guest_count):'',coordinator_name:vc.coordinator_name||'',coordinator_phone:vc.coordinator_phone||'',ceremony_type:vc.ceremony_type||'',wedding_space_id:vc.wedding_space_id||'',catering_notes:vc.catering_notes||''});setWeddingError('');setEditingWedding(true);}} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"><Pencil size={11}/>{vc.wedding_date||vc.guest_count?'Edit':'Add'}</button>}
                    </div>
                    {editingWedding ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          {([{k:'wedding_date',l:'Wedding Date',t:'date'},{k:'rehearsal_date',l:'Rehearsal',t:'date'},{k:'guest_count',l:'Guests',t:'number'},{k:'coordinator_name',l:'Coordinator',t:'text'},{k:'coordinator_phone',l:'Coord. Phone',t:'tel'}] as const).map((f)=>(
                            <div key={f.k}><label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{f.l}</label>
                              <input type={f.t} value={weddingForm[f.k]} onChange={(e)=>setWeddingForm((p)=>({...p,[f.k]:e.target.value}))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"/></div>
                          ))}
                          <div><label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Ceremony</label>
                            <select value={weddingForm.ceremony_type} onChange={(e)=>setWeddingForm((p)=>({...p,ceremony_type:e.target.value}))} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none">
                              <option value="">Not set</option>{CEREMONY_TYPES.map((c)=><option key={c.value} value={c.value}>{c.label}</option>)}
                            </select></div>
                          {spaces.length > 0 && <div><label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Space</label>
                            <select value={weddingForm.wedding_space_id} onChange={(e)=>setWeddingForm((p)=>({...p,wedding_space_id:e.target.value}))} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none">
                              <option value="">Not assigned</option>{spaces.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}
                            </select></div>}
                        </div>
                        <div><label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Catering Notes</label>
                          <textarea value={weddingForm.catering_notes} onChange={(e)=>setWeddingForm((p)=>({...p,catering_notes:e.target.value}))} rows={2} className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"/></div>
                        <EditFooter onCancel={()=>setEditingWedding(false)} onSave={()=>void saveWedding()} saving={savingWedding} err={weddingError}/>
                      </div>
                    ) : (vc.wedding_date||vc.guest_count||vc.ceremony_type) ? (
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        {vc.wedding_date && <div><p className="text-[11px] text-gray-400">Wedding Date</p><p className="font-medium text-gray-900">{formatDate(vc.wedding_date)}</p></div>}
                        {vc.rehearsal_date && <div><p className="text-[11px] text-gray-400">Rehearsal</p><p className="font-medium text-gray-900">{formatDate(vc.rehearsal_date)}</p></div>}
                        {vc.guest_count!=null && <div><p className="text-[11px] text-gray-400">Guests</p><p className="font-medium text-gray-900">{vc.guest_count}</p></div>}
                        {vc.ceremony_type && <div><p className="text-[11px] text-gray-400">Ceremony</p><p className="font-medium text-gray-900">{CEREMONY_TYPES.find((c)=>c.value===vc.ceremony_type)?.label??vc.ceremony_type}</p></div>}
                        {vc.coordinator_name && <div className="col-span-2"><p className="text-[11px] text-gray-400">Coordinator</p><p className="font-medium text-gray-900">{vc.coordinator_name}{vc.coordinator_phone && <span className="font-normal text-gray-500"> · {vc.coordinator_phone}</span>}</p></div>}
                        {vc.catering_notes && <div className="col-span-2"><p className="text-[11px] text-gray-400">Catering Notes</p><p className="text-gray-700">{vc.catering_notes}</p></div>}
                      </div>
                    ) : <p className="text-xs text-gray-400">No event details yet.</p>}
                  </div>
                </div>
              )}

              {/* NOTES */}
              {activeTab === 'notes' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <textarea value={newNote} onChange={(e)=>setNewNote(e.target.value)} placeholder="Add a note…" rows={3}
                      className="w-full resize-none rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none mb-3"
                      onKeyDown={(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void addNote();}}}/>
                    {noteError && <p className="text-xs text-red-600 flex items-center gap-1 mb-2"><AlertCircle size={12}/>{noteError}</p>}
                    <button onClick={()=>void addNote()} disabled={savingNote||!newNote.trim()} className="rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-40" style={{backgroundColor:'#1b1b1b'}}>
                      {savingNote?'Saving…':'Add Note'}
                    </button>
                  </div>
                  {notes.length===0 && <p className="text-sm text-gray-400">No notes yet.</p>}
                  {notes.map((n)=>(
                    <div key={n.id} className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 group relative">
                      {editingNoteId===n.id ? (
                        <>
                          <textarea value={editNoteContent} onChange={(e)=>setEditNoteContent(e.target.value)} rows={3} autoFocus className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"/>
                          <div className="flex gap-2 mt-2">
                            <button onClick={()=>void saveEditNote()} disabled={savingEditNote||!editNoteContent.trim()} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{savingEditNote?'Saving…':'Save'}</button>
                            <button onClick={()=>{setEditingNoteId(null);setEditNoteContent('');}} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-gray-800 whitespace-pre-wrap">{n.content}</p>
                          <div className="flex items-center justify-between mt-1.5">
                            <p className="text-[11px] text-gray-400">{n.author_name?`${n.author_name} · `:''}{formatDateTime(n.created_at)}</p>
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={()=>{setEditingNoteId(n.id);setEditNoteContent(n.content);}} className="text-gray-400 hover:text-gray-700"><Pencil size={13}/></button>
                              <button onClick={()=>void deleteNote(n.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={13}/></button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ACTIVITY */}
              {activeTab === 'activity' && (
                <div>
                  {activity.length===0 ? <p className="text-sm text-gray-400">No activity recorded yet.</p> : (
                    <div className="relative">
                      <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-200"/>
                      <div className="space-y-4">
                        {activity.map((a)=>(
                          <div key={a.id} className="flex gap-4">
                            <div className="relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 border-white bg-gray-100 text-gray-500">{ACTIVITY_ICONS[a.activity_type]??<Info size={12}/>}</div>
                            <div className="flex-1 pb-4">
                              <p className="text-sm font-medium text-gray-900">{a.title}</p>
                              {a.description && <p className="text-xs text-gray-500 mt-0.5">{a.description}</p>}
                              <p className="text-[11px] text-gray-400 mt-1">{formatDateTime(a.created_at)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* PAYMENTS */}
              {activeTab === 'payments' && (
                <div className="space-y-4">
                  {loadingPayments ? (
                    <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-gray-400"/></div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <input type="text" value={proposalSearch} onChange={(e)=>setProposalSearch(e.target.value)} placeholder="Search…" className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"/>
                        <Link href={`/dashboard/payments/new?type=proposal${displayEmail?`&email=${encodeURIComponent(displayEmail)}&name=${encodeURIComponent(displayName)}`:''}`}
                          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white whitespace-nowrap" style={{backgroundColor:'#1b1b1b'}}>
                          <Plus size={13}/>New proposal
                        </Link>
                      </div>
                      {proposals.length===0 ? <p className="text-sm text-gray-400">No proposals yet.</p> : (
                        <div className="overflow-x-auto rounded-xl border border-gray-200">
                          <table className="w-full text-left text-sm">
                            <thead><tr className="border-b border-gray-200 bg-gray-50/60">{['Status','Amount','Type','Sent',''].map((h)=><th key={h} className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{h}</th>)}</tr></thead>
                            <tbody className="divide-y divide-gray-100">
                              {proposals.filter((p)=>!proposalSearch||[p.status,p.payment_type].some((v)=>v?.toLowerCase().includes(proposalSearch.toLowerCase())))
                                .sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())
                                .map((p)=>{const color=getStatusColor(p.status);return(
                                <tr key={p.id} className="hover:bg-gray-50/50">
                                  <td className="px-3 py-2.5"><span className={classNames('inline-block rounded-full px-2 py-0.5 text-[10px] font-medium capitalize',color.bg,color.text)}>{p.status}</span></td>
                                  <td className="px-3 py-2.5 text-gray-700">{formatCents(p.price)}</td>
                                  <td className="px-3 py-2.5 text-gray-500 capitalize">{p.payment_type}</td>
                                  <td className="px-3 py-2.5 text-xs text-gray-400">{p.sent_at?formatDate(p.sent_at):'—'}</td>
                                  <td className="px-3 py-2.5"><div className="flex items-center gap-1">
                                    <Link href={`/dashboard/proposals/${p.id}/edit`} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Pencil size={12}/></Link>
                                    {p.status!=='paid'&&<button onClick={()=>void handleResend(p)} disabled={resendingId===p.id} className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-40"><RefreshCw size={12} className={resendingId===p.id?'animate-spin':''}/></button>}
                                    <button onClick={()=>copyLink(p)} className="rounded p-1 text-gray-400 hover:bg-gray-100"><Copy size={12}/>{copiedId===p.id&&<span className="ml-1 text-[10px]">✓</span>}</button>
                                    <Link href={`/proposal/${p.public_token}`} target="_blank" className="rounded p-1 text-gray-400 hover:bg-gray-100"><ExternalLink size={12}/></Link>
                                    {p.status==='paid'&&<Link href={`/invoice/${p.id}`} target="_blank" className="rounded p-1 text-gray-400 hover:bg-gray-100"><Receipt size={12}/></Link>}
                                  </div></td>
                                </tr>);})}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* TASKS */}
              {activeTab === 'tasks' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex gap-2 mb-2">
                      <input value={newTask} onChange={(e)=>setNewTask(e.target.value)} placeholder="New task…" onKeyDown={(e)=>{if(e.key==='Enter'&&!savingTask)void addTask();}} className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"/>
                      <input type="date" value={newTaskDue} onChange={(e)=>setNewTaskDue(e.target.value)} className="rounded-xl border border-gray-200 px-2 py-2 text-sm focus:border-gray-400 focus:outline-none w-32"/>
                      <button onClick={()=>void addTask()} disabled={savingTask||!newTask.trim()} className="rounded-xl px-3 py-2 text-white disabled:opacity-40" style={{backgroundColor:'#1b1b1b'}}>{savingTask?<Loader2 size={14} className="animate-spin"/>:<Plus size={15}/>}</button>
                    </div>
                    {taskError&&<p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={12}/>{taskError}</p>}
                  </div>
                  {openTasks.length===0&&<p className="text-sm text-gray-400">No open tasks.</p>}
                  {openTasks.map((t)=>(
                    <div key={t.id} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 group">
                      <button onClick={()=>void toggleTask(t)} className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 border-gray-300 hover:border-emerald-400 transition-colors"/>
                      {editingTaskId===t.id ? (
                        <div className="flex flex-1 flex-wrap gap-2">
                          <input value={editTaskTitle} onChange={(e)=>setEditTaskTitle(e.target.value)} autoFocus onKeyDown={(e)=>{if(e.key==='Enter'&&!savingEditTask)void saveEditTask();if(e.key==='Escape'){setEditingTaskId(null);setEditTaskTitle('');setEditTaskDue('');}}} className="flex-1 min-w-[120px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none"/>
                          <input type="date" value={editTaskDue} onChange={(e)=>setEditTaskDue(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-gray-500 focus:outline-none"/>
                          <button onClick={()=>void saveEditTask()} disabled={savingEditTask||!editTaskTitle.trim()} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{savingEditTask?'Saving…':'Save'}</button>
                          <button onClick={()=>{setEditingTaskId(null);setEditTaskTitle('');setEditTaskDue('');}} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
                        </div>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0"><p className="text-sm text-gray-900">{t.title}</p>{t.due_date&&<p className={`text-xs mt-0.5 ${new Date(t.due_date)<new Date()?'text-red-500 font-medium':'text-gray-400'}`}>Due {formatDate(t.due_date)}</p>}</div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={()=>void toggleTask(t)} className="text-xs text-emerald-600 font-medium flex items-center gap-0.5"><Check size={12}/>Done</button>
                            <button onClick={()=>{setEditingTaskId(t.id);setEditTaskTitle(t.title);setEditTaskDue(t.due_date??'');}} className="text-gray-400 hover:text-gray-700 ml-2"><Pencil size={13}/></button>
                            <button onClick={()=>void deleteTask(t.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={13}/></button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {completedTasks.length>0 && (
                    <div className="mt-3">
                      <button onClick={()=>setShowCompleted((v)=>!v)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600">
                        {showCompleted?<ChevronUp size={14}/>:<ChevronDown size={14}/>}{completedTasks.length} completed task{completedTasks.length!==1?'s':''}
                      </button>
                      {showCompleted && <div className="mt-2 space-y-2">
                        {completedTasks.map((t)=>(
                          <div key={t.id} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 group opacity-60 hover:opacity-100 transition-opacity">
                            <button onClick={()=>void toggleTask(t)} className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 border-emerald-400 bg-emerald-50 hover:bg-white hover:border-gray-400 transition-colors"><Check size={10} className="text-emerald-500"/></button>
                            <div className="flex-1"><p className="text-sm text-gray-500 line-through">{t.title}</p>{t.completed_at&&<p className="text-xs text-gray-400 mt-0.5">Completed {formatDate(t.completed_at)}</p>}</div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={()=>void toggleTask(t)} className="text-xs text-gray-600 font-medium flex items-center gap-0.5"><Undo2 size={12}/>Reopen</button>
                              <button onClick={()=>void deleteTask(t.id)} className="text-gray-300 hover:text-red-500 ml-1"><Trash2 size={13}/></button>
                            </div>
                          </div>
                        ))}
                      </div>}
                    </div>
                  )}
                </div>
              )}

              {/* DOCUMENTS */}
              {activeTab === 'documents' && (
                <div className="space-y-4">
                  {loadingDocs ? (
                    <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-gray-400"/></div>
                  ) : (
                    <>
                      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <select value={uploadType} onChange={(e)=>setUploadType(e.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-gray-400 focus:outline-none capitalize">
                            {FILE_TYPES.map((t)=><option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}
                          </select>
                          <label className={`flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white ${uploading?'opacity-50 cursor-not-allowed':''}`} style={{backgroundColor:'#1b1b1b'}}>
                            {uploading?<Loader2 size={14} className="animate-spin"/>:<Upload size={14}/>}{uploading?'Uploading…':'Upload File'}
                            <input ref={fileInputRef} type="file" className="hidden" disabled={uploading} onChange={handleFileUpload} accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xlsx,.csv"/>
                          </label>
                        </div>
                        {uploadError&&<p className="text-xs text-red-600 flex items-center gap-1 mt-2"><AlertCircle size={12}/>{uploadError}</p>}
                      </div>
                      {files.length===0 ? <p className="text-sm text-gray-400">No documents yet.</p> : (
                        <div className="overflow-x-auto rounded-xl border border-gray-200">
                          <table className="w-full text-left text-sm">
                            <thead><tr className="border-b border-gray-200 bg-gray-50/60">{['File','Type','Status','Date',''].map((h)=><th key={h} className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{h}</th>)}</tr></thead>
                            <tbody className="divide-y divide-gray-100">
                              {files.map((f)=>(
                                <tr key={f.id} className="hover:bg-gray-50/50">
                                  <td className="px-3 py-2.5">{f.url?<a href={f.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1.5 text-xs"><FileCheck size={12}/>{f.filename}</a>:<span className="flex items-center gap-1.5 text-xs text-gray-700"><FileCheck size={12}/>{f.filename}</span>}{f.file_size&&<p className="text-[10px] text-gray-400 mt-0.5">{(f.file_size/1024).toFixed(0)} KB</p>}</td>
                                  <td className="px-3 py-2.5 text-xs text-gray-500 capitalize">{f.file_type.replace(/_/g,' ')}</td>
                                  <td className="px-3 py-2.5"><select value={f.file_status} onChange={(e)=>void updateFileStatus(f.id,e.target.value)} className={`rounded-full border-0 px-2 py-0.5 text-[10px] font-semibold cursor-pointer focus:outline-none capitalize ${FILE_STATUS_COLORS[f.file_status]??'bg-gray-100 text-gray-700'}`}>{FILE_STATUSES.map((s)=><option key={s} value={s}>{s}</option>)}</select></td>
                                  <td className="px-3 py-2.5 text-xs text-gray-400">{formatDate(f.created_at)}</td>
                                  <td className="px-3 py-2.5"><button onClick={()=>void deleteFile(f.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={13}/></button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* SCHEDULE */}
              {activeTab === 'schedule' && (
                <div className="space-y-4">
                  {/* Booking form toggle */}
                  {!showApptForm ? (
                    <button
                      type="button"
                      onClick={() => { setShowApptForm(true); setApptError(''); setApptConflict(null); }}
                      className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
                      style={{backgroundColor:'#1b1b1b'}}
                    >
                      <CalendarPlus size={15}/>Schedule Appointment
                    </button>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                      <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5"><CalendarPlus size={14}/>New Appointment</h4>

                      {/* Event type */}
                      <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Type</label>
                        <div className="flex flex-wrap gap-1.5">
                          {APPOINTMENT_EVENT_TYPES.map((et) => (
                            <button key={et.value} type="button"
                              onClick={() => setApptForm((p) => ({...p, event_type: et.value}))}
                              className={classNames(
                                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                                apptForm.event_type === et.value
                                  ? 'border-gray-900 bg-gray-900 text-white'
                                  : 'border-gray-200 text-gray-600 hover:border-gray-400',
                              )}>
                              {et.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Title */}
                      <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Title (optional)</label>
                        <input
                          value={apptForm.title}
                          onChange={(e) => setApptForm((p) => ({...p, title: e.target.value}))}
                          placeholder={`${displayName} — ${apptForm.event_type.replace(/_/g,' ')}`}
                          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                        />
                      </div>

                      {/* Date + times */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-3 sm:col-span-1">
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Date</label>
                          <input type="date" value={apptForm.date} onChange={(e) => setApptForm((p) => ({...p, date: e.target.value}))}
                            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"/>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Start</label>
                          <input type="time" value={apptForm.start_time} onChange={(e) => setApptForm((p) => ({...p, start_time: e.target.value}))}
                            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"/>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">End</label>
                          <input type="time" value={apptForm.end_time} onChange={(e) => setApptForm((p) => ({...p, end_time: e.target.value}))}
                            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"/>
                        </div>
                      </div>

                      {/* Space */}
                      {spaces.length > 0 && (
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Space (optional)</label>
                          <select value={apptForm.space_id} onChange={(e) => setApptForm((p) => ({...p, space_id: e.target.value}))}
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none">
                            <option value="">No space</option>
                            {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                      )}

                      {/* Notes */}
                      <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Notes (optional)</label>
                        <textarea value={apptForm.notes} onChange={(e) => setApptForm((p) => ({...p, notes: e.target.value}))} rows={2}
                          className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"/>
                      </div>

                      {/* Conflict warning */}
                      {apptConflict && apptConflict.length > 0 && (
                        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-2">
                          <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5"><AlertCircle size={13}/>Space conflict with:</p>
                          {apptConflict.map((c, i) => (
                            <p key={i} className="text-xs text-amber-800">• {c.title} — {new Date(c.start_at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</p>
                          ))}
                          <button type="button" onClick={() => void saveAppointment(true)}
                            className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800">
                            Schedule anyway
                          </button>
                        </div>
                      )}

                      {apptError && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={12}/>{apptError}</p>}

                      <div className="flex gap-2 pt-1">
                        <button type="button" onClick={() => { setShowApptForm(false); setApptError(''); setApptConflict(null); }}
                          className="flex-1 rounded-xl border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                        <button type="button" onClick={() => void saveAppointment(false)} disabled={savingAppt || !apptForm.date}
                          className="flex-1 rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-40"
                          style={{backgroundColor:'#1b1b1b'}}>
                          {savingAppt ? 'Saving…' : 'Book Appointment'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Appointments list */}
                  {loadingAppts ? (
                    <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-gray-400"/></div>
                  ) : appointments.length === 0 ? (
                    <p className="text-sm text-gray-400">No appointments yet.</p>
                  ) : (
                    <>
                      {upcomingAppts.length > 0 && (
                        <div>
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Upcoming</p>
                          <div className="space-y-2">
                            {upcomingAppts.map((a) => (
                              <ApptCard key={a.id} appt={a} onCancel={() => void cancelAppointment(a.id)}/>
                            ))}
                          </div>
                        </div>
                      )}
                      {appointments.filter((a) => new Date(a.end_at) < new Date()).length > 0 && (
                        <div>
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Past</p>
                          <div className="space-y-2 opacity-60">
                            {appointments.filter((a) => new Date(a.end_at) < new Date()).slice(-5).reverse().map((a) => (
                              <ApptCard key={a.id} appt={a} past />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 border-t border-gray-100 px-5 py-3">
              <Link href={`/dashboard/contacts/${venueCustomerId}`} className="flex items-center justify-center gap-2 text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors">
                <ExternalLink size={12}/>Open full profile page<ChevronRight size={12} className="text-gray-400"/>
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
