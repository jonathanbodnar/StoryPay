'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Mail, Phone, MapPin, FileText, Loader2, ExternalLink,
  Receipt, Pencil, Copy, RefreshCw, RotateCcw, X as XIcon,
  Plus, Check, Trash2, Upload, Calendar, ClipboardList,
  FileCheck, Activity, User, Heart, ChevronDown, ChevronUp, Info,
  AlertCircle, Undo2,
} from 'lucide-react';
import RefundModal from '@/components/RefundModal';
import { formatCents, formatDate, formatDateTime, getStatusColor, classNames } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Customer {
  id: number; name: string; firstName: string; lastName: string;
  email: string; phone: string; address: string; city: string; state: string; zip: string;
}

interface PipelineContext {
  pipelineId: string;
  stageId: string;
  linkedLeadId: string | null;
  resolvedFromLead: boolean;
}

interface PipelineStageRow {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  kind: string;
  position: number;
}

interface VenuePipeline {
  id: string;
  name: string;
  is_default: boolean;
  stages: PipelineStageRow[];
}

interface VenueCustomer {
  id: string; customer_email: string; first_name: string; last_name: string;
  phone: string | null;
  partner_first_name: string | null; partner_last_name: string | null;
  partner_email: string | null; partner_phone: string | null;
  wedding_date: string | null; wedding_space_id: string | null;
  ceremony_type: string | null; guest_count: number | null;
  rehearsal_date: string | null; coordinator_name: string | null;
  coordinator_phone: string | null; catering_notes: string | null;
  referral_source: string | null; pipeline_stage: string;
  pipeline_id?: string | null;
  stage_id?: string | null;
  pipeline_context?: PipelineContext;
  venue_spaces: { id: string; name: string; color: string } | null;
}

interface Proposal {
  id: string; customer_name: string; customer_email: string; status: string;
  price: number; payment_type: string; payment_config: Record<string, unknown> | null;
  public_token: string; charge_id?: string | null;
  sent_at: string | null; signed_at: string | null; paid_at: string | null; created_at: string;
}

interface Note { id: string; content: string; author_name: string | null; created_at: string; }
interface Task { id: string; title: string; due_date: string | null; completed_at: string | null; created_at: string; }
interface FileRow {
  id: string; filename: string; file_type: string; file_status: string;
  file_size: number | null; uploaded_by: string | null; created_at: string; url: string | null;
}
interface ActivityEntry {
  id: string; activity_type: string; title: string; description: string | null; created_at: string;
}

const REFERRAL_SOURCES = ['Instagram','Google','Wedding Wire','The Knot','Referral','Venue Website','Facebook','Other'];
const CEREMONY_TYPES   = [
  { value: 'ceremony_only',       label: 'Ceremony Only' },
  { value: 'reception_only',      label: 'Reception Only' },
  { value: 'ceremony_reception',  label: 'Ceremony & Reception' },
];

const FILE_TYPES    = ['contract','floor_plan','vendor_agreement','insurance','photo','other'];
const FILE_STATUSES = ['pending','received','approved'];

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  proposal_sent:     <FileText size={13} />,
  proposal_viewed:   <ExternalLink size={13} />,
  proposal_signed:   <FileCheck size={13} />,
  payment_made:      <Receipt size={13} />,
  installment_paid:  <Receipt size={13} />,
  note_added:        <ClipboardList size={13} />,
  file_uploaded:     <Upload size={13} />,
  task_created:      <Plus size={13} />,
  task_completed:    <Check size={13} />,
  event_created:     <Calendar size={13} />,
  stage_changed:     <Activity size={13} />,
};

const FILE_STATUS_COLORS: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-700',
  received: 'bg-blue-100 text-blue-700',
  approved: 'bg-emerald-100 text-emerald-700',
};

type Tab = 'overview' | 'notes' | 'timeline' | 'payments' | 'tasks' | 'documents';

// ── Main component ─────────────────────────────────────────────────────────────
export default function CustomerDetailPage() {
  const params     = useParams();
  const router     = useRouter();
  const customerId = params.id as string;

  // Core data
  const [customer,      setCustomer]      = useState<Customer | null>(null);
  const [venueCustomer, setVenueCustomer] = useState<VenueCustomer | null>(null);
  const [proposals,     setProposals]     = useState<Proposal[]>([]);
  const [notes,         setNotes]         = useState<Note[]>([]);
  const [tasks,         setTasks]         = useState<Task[]>([]);
  const [files,         setFiles]         = useState<FileRow[]>([]);
  const [activity,      setActivity]      = useState<ActivityEntry[]>([]);
  const [spaces,        setSpaces]        = useState<{ id: string; name: string; color: string; capacity?: number | null }[]>([]);
  const [pipelines,     setPipelines]     = useState<VenuePipeline[]>([]);

  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Contact edit
  const [editingContact, setEditingContact] = useState(false);
  const [editForm,       setEditForm]       = useState({ firstName: '', lastName: '', email: '', phone: '', address: '', city: '', state: '', zip: '' });
  const [savingContact,  setSavingContact]  = useState(false);
  const [contactError,   setContactError]   = useState('');

  // Partner edit — separate state from wedding details
  const [editingPartner, setEditingPartner] = useState(false);
  const [partnerForm,    setPartnerForm]    = useState({ partner_first_name: '', partner_last_name: '', partner_email: '', partner_phone: '', referral_source: '' });
  const [savingPartner,  setSavingPartner]  = useState(false);
  const [partnerError,   setPartnerError]   = useState('');

  // Wedding details edit — separate state
  const [editingWedding, setEditingWedding] = useState(false);
  const [weddingForm,    setWeddingForm]    = useState<{
    wedding_date: string; rehearsal_date: string; guest_count: string;
    coordinator_name: string; coordinator_phone: string;
    ceremony_type: string; wedding_space_id: string; catering_notes: string;
  }>({ wedding_date: '', rehearsal_date: '', guest_count: '', coordinator_name: '', coordinator_phone: '', ceremony_type: '', wedding_space_id: '', catering_notes: '' });
  const [savingWedding,  setSavingWedding]  = useState(false);
  const [weddingError,   setWeddingError]   = useState('');

  // Proposals
  const [proposalSearch, setProposalSearch] = useState('');
  const [copiedId,       setCopiedId]       = useState<string | null>(null);
  const [resendingId,    setResendingId]     = useState<string | null>(null);
  const [refundTarget,   setRefundTarget]    = useState<Proposal | null>(null);

  // Notes
  const [newNote,         setNewNote]         = useState('');
  const [savingNote,      setSavingNote]      = useState(false);
  const [noteError,       setNoteError]       = useState('');
  const [editingNoteId,   setEditingNoteId]   = useState<string | null>(null);
  const [editNoteContent, setEditNoteContent] = useState('');
  const [savingEditNote,  setSavingEditNote]  = useState(false);

  // Tasks
  const [newTask,         setNewTask]         = useState('');
  const [newTaskDue,      setNewTaskDue]      = useState('');
  const [savingTask,      setSavingTask]      = useState(false);
  const [taskError,       setTaskError]       = useState('');
  const [showCompleted,   setShowCompleted]   = useState(false);
  const [editingTaskId,   setEditingTaskId]   = useState<string | null>(null);
  const [editTaskTitle,   setEditTaskTitle]   = useState('');
  const [editTaskDue,     setEditTaskDue]     = useState('');
  const [savingEditTask,  setSavingEditTask]  = useState(false);

  // Files
  const [uploading,    setUploading]    = useState(false);
  const [uploadType,   setUploadType]   = useState('other');
  const [uploadError,  setUploadError]  = useState('');

  // Venue Spaces management (venue-level, shown on overview)
  const [showSpaceManager, setShowSpaceManager] = useState(false);
  const [newSpaceName,     setNewSpaceName]     = useState('');
  const [newSpaceColor,    setNewSpaceColor]    = useState('#6366f1');
  const [newSpaceCap,      setNewSpaceCap]      = useState('');
  const [savingSpace,      setSavingSpace]      = useState(false);

  // ── Fetch all data ─────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [cRes, pipeRes] = await Promise.all([
        fetch(`/api/customers/${customerId}`),
        fetch('/api/pipelines', { cache: 'no-store' }),
      ]);
      if (pipeRes.ok) {
        const pd = await pipeRes.json();
        setPipelines(Array.isArray(pd.pipelines) ? pd.pipelines : []);
      }
      if (!cRes.ok) { setError('Customer not found'); setLoading(false); return; }
      const cData = await cRes.json();
      setCustomer(cData.customer);
      setProposals(cData.proposals || []);

      const email      = cData.customer?.email?.toLowerCase() ?? '';
      const firstName  = cData.customer?.firstName || '';
      const lastName   = cData.customer?.lastName  || '';
      const phone      = cData.customer?.phone     || null;
      // Use the external customer ID as a stable key for customers without email
      const externalId = String(cData.customer?.id || customerId);

      // ── Ensure a local venue_customer record always exists ─────────────────
      // Use POST lookup (avoids @ in URL), then create if not found.
      let vc: VenueCustomer | null = null;

      if (email) {
        // Customers with email: look up by email first
        const lookupRes = await fetch('/api/venue-customers/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (lookupRes.ok) vc = await lookupRes.json();
      }

      if (!vc) {
        // Either no email, or lookup returned null — create the record
        const createRes = await fetch('/api/venue-customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_email: email || null,   // API generates placeholder if empty
            first_name: firstName,
            last_name:  lastName,
            phone,
            external_id: externalId,
          }),
        });
        if (createRes.ok) {
          vc = await createRes.json();
        } else {
          // Last resort: try lookup by generated placeholder email
          if (!email) {
            const placeholderEmail = `no-email-${externalId.toLowerCase().replace(/[^a-z0-9]/g, '-')}@storypay.internal`;
            const retryRes = await fetch('/api/venue-customers/lookup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: placeholderEmail }),
            });
            if (retryRes.ok) vc = await retryRes.json();
          }
        }
      }

      if (vc?.id) {
        const detailRes = await fetch(`/api/venue-customers/${vc.id}`, { cache: 'no-store' });
        if (detailRes.ok) {
          vc = await detailRes.json();
        }
      }

      setVenueCustomer(vc);

      const spRes = await fetch('/api/spaces');
      if (spRes.ok) setSpaces(await spRes.json());

      if (vc?.id) {
        const [notesRes, tasksRes, filesRes, actRes] = await Promise.all([
          fetch(`/api/venue-customers/${vc.id}/notes`),
          fetch(`/api/venue-customers/${vc.id}/tasks`),
          fetch(`/api/venue-customers/${vc.id}/files`),
          fetch(`/api/venue-customers/${vc.id}/activity`),
        ]);
        if (notesRes.ok) setNotes(await notesRes.json());
        if (tasksRes.ok) setTasks(await tasksRes.json());
        if (filesRes.ok) setFiles(await filesRes.json());
        if (actRes.ok)   setActivity(await actRes.json());
      }
    } catch {
      setError('Failed to load customer');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Contact save ────────────────────────────────────────────────────────────
  function startEditContact() {
    if (!customer) return;
    setEditForm({
      firstName: customer.firstName || '', lastName: customer.lastName || '',
      email: customer.email || '', phone: customer.phone || '',
      address: customer.address || '', city: customer.city || '',
      state: customer.state || '', zip: customer.zip || '',
    });
    setContactError('');
    setEditingContact(true);
  }

  async function saveContact() {
    setSavingContact(true);
    setContactError('');
    const res = await fetch(`/api/customers/${customerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    if (res.ok) {
      const d = await res.json();
      setCustomer(p => p ? { ...p, ...d.customer } : p);
      setEditingContact(false);
    } else {
      const d = await res.json().catch(() => ({}));
      setContactError(d.error || 'Failed to save — please try again');
    }
    setSavingContact(false);
  }

  // ── Partner save ────────────────────────────────────────────────────────────
  function startEditPartner() {
    // Allow opening even if venueCustomer is null — save will attempt to create it
    setPartnerForm({
      partner_first_name: venueCustomer?.partner_first_name || '',
      partner_last_name:  venueCustomer?.partner_last_name  || '',
      partner_email:      venueCustomer?.partner_email      || '',
      partner_phone:      venueCustomer?.partner_phone      || '',
      referral_source:    venueCustomer?.referral_source    || '',
    });
    setPartnerError('');
    setEditingPartner(true);
  }

  async function savePartner() {
    setSavingPartner(true);
    setPartnerError('');
    // If we still don't have a venue_customer, reload — it should exist now
    if (!venueCustomer) { await fetchAll(); setSavingPartner(false); return; }
    const res = await fetch(`/api/venue-customers/${venueCustomer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partnerForm),
    });
    if (res.ok) {
      const d = await res.json();
      setVenueCustomer(d);
      setEditingPartner(false);
    } else {
      const d = await res.json().catch(() => ({}));
      setPartnerError(d.error || 'Failed to save — please try again');
    }
    setSavingPartner(false);
  }

  // ── Wedding details save ─────────────────────────────────────────────────────
  function startEditWedding() {
    // Allow opening even if venueCustomer is null — save will create it
    setWeddingForm({
      wedding_date:      venueCustomer?.wedding_date      || '',
      rehearsal_date:    venueCustomer?.rehearsal_date    || '',
      guest_count:       venueCustomer?.guest_count != null ? String(venueCustomer.guest_count) : '',
      coordinator_name:  venueCustomer?.coordinator_name  || '',
      coordinator_phone: venueCustomer?.coordinator_phone || '',
      ceremony_type:     venueCustomer?.ceremony_type     || '',
      wedding_space_id:  venueCustomer?.wedding_space_id  || '',
      catering_notes:    venueCustomer?.catering_notes    || '',
    });
    setWeddingError('');
    setEditingWedding(true);
  }

  async function saveWedding() {
    setSavingWedding(true);
    if (!venueCustomer) { await fetchAll(); setSavingWedding(false); return; }
    setWeddingError('');
    const payload = {
      ...weddingForm,
      guest_count:       weddingForm.guest_count ? parseInt(weddingForm.guest_count, 10) : null,
      wedding_date:      weddingForm.wedding_date      || null,
      rehearsal_date:    weddingForm.rehearsal_date    || null,
      coordinator_name:  weddingForm.coordinator_name  || null,
      coordinator_phone: weddingForm.coordinator_phone || null,
      ceremony_type:     weddingForm.ceremony_type     || null,
      wedding_space_id:  weddingForm.wedding_space_id  || null,
      catering_notes:    weddingForm.catering_notes    || null,
    };
    const res = await fetch(`/api/venue-customers/${venueCustomer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const d = await res.json();
      setVenueCustomer(d);
      setEditingWedding(false);
    } else {
      const d = await res.json().catch(() => ({}));
      setWeddingError(d.error || 'Failed to save — please try again');
    }
    setSavingWedding(false);
  }

  // ── Pipeline / stage (synced with Leads Kanban via shared pipeline + stage ids) ─
  async function applyPipelineAndStage(pipelineId: string, stageId: string) {
    if (!venueCustomer) return;
    const res = await fetch(`/api/venue-customers/${venueCustomer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelineId, stageId }),
    });
    if (res.ok) setVenueCustomer(await res.json());
  }

  async function changePipeline(newPipelineId: string) {
    const pipe = pipelines.find((p) => p.id === newPipelineId);
    const first = pipe?.stages?.[0];
    if (!first) return;
    await applyPipelineAndStage(newPipelineId, first.id);
  }

  async function updateStage(stageId: string) {
    const pid =
      venueCustomer?.pipeline_id
      ?? venueCustomer?.pipeline_context?.pipelineId
      ?? pipelines.find((p) => p.is_default)?.id
      ?? pipelines[0]?.id;
    if (!venueCustomer || !pid) return;
    await applyPipelineAndStage(pid, stageId);
  }

  // ── Notes ──────────────────────────────────────────────────────────────────
  async function addNote() {
    if (!newNote.trim()) return;
    if (!venueCustomer) {
      setNoteError('Setting up profile, please try again in a moment…');
      await fetchAll();
      setNoteError('');
      return;
    }
    setSavingNote(true);
    setNoteError('');
    const res = await fetch(`/api/venue-customers/${venueCustomer.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newNote.trim() }),
    });
    if (res.ok) {
      const n = await res.json();
      setNotes(p => [n, ...p]);
      setNewNote('');
      setActivity(p => [{
        id: n.id + '-act', activity_type: 'note_added', title: 'Note added',
        description: newNote.trim().slice(0, 80), created_at: new Date().toISOString(),
      }, ...p]);
    } else {
      const d = await res.json().catch(() => ({}));
      setNoteError(d.error || 'Failed to save note — please try again');
    }
    setSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    if (!venueCustomer) return;
    await fetch(`/api/venue-customers/${venueCustomer.id}/notes?noteId=${noteId}`, { method: 'DELETE' });
    setNotes(p => p.filter(n => n.id !== noteId));
  }

  async function saveEditNote() {
    if (!venueCustomer || !editingNoteId) return;
    const trimmed = editNoteContent.trim();
    if (!trimmed) return;
    setSavingEditNote(true);
    const res = await fetch(`/api/venue-customers/${venueCustomer.id}/notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId: editingNoteId, content: trimmed }),
    });
    if (res.ok) {
      const updated = await res.json();
      setNotes(p => p.map(n => n.id === editingNoteId ? { ...n, content: updated.content ?? trimmed } : n));
      setEditingNoteId(null);
      setEditNoteContent('');
    }
    setSavingEditNote(false);
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────
  async function addTask() {
    if (!newTask.trim()) return;
    if (!venueCustomer) {
      setTaskError('Setting up profile, please try again in a moment…');
      await fetchAll();
      setTaskError('');
      return;
    }
    setSavingTask(true);
    setTaskError('');
    const res = await fetch(`/api/venue-customers/${venueCustomer.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTask.trim(), due_date: newTaskDue || null }),
    });
    if (res.ok) {
      const t = await res.json();
      setTasks(p => [...p, t]);
      setNewTask('');
      setNewTaskDue('');
    } else {
      const d = await res.json().catch(() => ({}));
      setTaskError(d.error || 'Failed to save task — please try again');
    }
    setSavingTask(false);
  }

  async function toggleTask(task: Task) {
    if (!venueCustomer) return;
    const completed_at = task.completed_at ? null : new Date().toISOString();
    const res = await fetch(`/api/venue-customers/${venueCustomer.id}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed_at }),
    });
    if (res.ok) setTasks(p => p.map(x => x.id === task.id ? { ...x, completed_at } : x));
  }

  async function deleteTask(taskId: string) {
    if (!venueCustomer) return;
    await fetch(`/api/venue-customers/${venueCustomer.id}/tasks/${taskId}`, { method: 'DELETE' });
    setTasks(p => p.filter(t => t.id !== taskId));
  }

  async function saveEditTask() {
    if (!venueCustomer || !editingTaskId) return;
    const trimmed = editTaskTitle.trim();
    if (!trimmed) return;
    setSavingEditTask(true);
    const res = await fetch(`/api/venue-customers/${venueCustomer.id}/tasks/${editingTaskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed, due_date: editTaskDue || null }),
    });
    if (res.ok) {
      setTasks(p => p.map(t => t.id === editingTaskId
        ? { ...t, title: trimmed, due_date: editTaskDue || null }
        : t));
      setEditingTaskId(null);
      setEditTaskTitle('');
      setEditTaskDue('');
    }
    setSavingEditTask(false);
  }

  // ── Files ──────────────────────────────────────────────────────────────────
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!venueCustomer) {
      setUploadError('Setting up profile, please try again in a moment…');
      await fetchAll();
      setUploadError('');
      return;
    }
    setUploading(true);
    setUploadError('');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('file_type', uploadType);
    const res = await fetch(`/api/venue-customers/${venueCustomer.id}/files`, { method: 'POST', body: fd });
    if (res.ok) {
      const f = await res.json();
      setFiles(p => [f, ...p]);
    } else {
      const d = await res.json().catch(() => ({}));
      setUploadError(d.error || 'Upload failed — please try again');
    }
    e.target.value = '';
    setUploading(false);
  }

  async function updateFileStatus(fileId: string, file_status: string) {
    if (!venueCustomer) return;
    const res = await fetch(`/api/venue-customers/${venueCustomer.id}/files`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId, file_status }),
    });
    if (res.ok) {
      const f = await res.json();
      setFiles(p => p.map(x => x.id === f.id ? { ...x, ...f } : x));
    }
  }

  async function deleteFile(fileId: string) {
    if (!venueCustomer) return;
    await fetch(`/api/venue-customers/${venueCustomer.id}/files?fileId=${fileId}`, { method: 'DELETE' });
    setFiles(p => p.filter(f => f.id !== fileId));
  }

  // ── Venue Spaces CRUD ─────────────────────────────────────────────────────
  async function addSpace() {
    if (!newSpaceName.trim()) return;
    setSavingSpace(true);
    const res = await fetch('/api/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newSpaceName.trim(), color: newSpaceColor, capacity: newSpaceCap ? Number(newSpaceCap) : null }),
    });
    if (res.ok) {
      const s = await res.json();
      setSpaces(prev => [...prev, s]);
      setNewSpaceName(''); setNewSpaceColor('#6366f1'); setNewSpaceCap('');
    }
    setSavingSpace(false);
  }

  async function removeSpace(id: string) {
    await fetch(`/api/spaces/${id}`, { method: 'DELETE' });
    setSpaces(prev => prev.filter(s => s.id !== id));
    // If this space was selected in wedding form, clear it
    if (weddingForm.wedding_space_id === id) setWeddingForm(p => ({ ...p, wedding_space_id: '' }));
  }

  // ── Proposal helpers ──────────────────────────────────────────────────────
  function copyLink(p: Proposal) {
    navigator.clipboard.writeText(`${window.location.origin}/proposal/${p.public_token}`);
    setCopiedId(p.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleResend(p: Proposal) {
    setResendingId(p.id);
    const res = await fetch(`/api/proposals/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sendNow: true }),
    });
    if (res.ok) alert('Proposal resent successfully.');
    else { const d = await res.json(); alert(d.error || 'Failed to resend'); }
    setResendingId(null);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const paidProposals    = proposals.filter(p => p.status === 'paid');
  const totalPaid        = paidProposals.reduce((s, p) => s + (p.price || 0), 0);
  const pendingProposals = proposals.filter(p => ['sent','opened','signed'].includes(p.status));
  const totalPending     = pendingProposals.reduce((s, p) => s + (p.price || 0), 0);
  const installmentProps = proposals.filter(p => p.payment_type === 'installment' && p.payment_config);
  const openTasks        = tasks.filter(t => !t.completed_at);
  const completedTasks   = tasks.filter(t => !!t.completed_at);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-400" size={24} /></div>;
  if (error || !customer) return (
    <div className="py-20 text-center">
      <p className="text-gray-500">{error || 'Customer not found'}</p>
      <button onClick={() => router.back()} className="mt-4 text-sm text-blue-600 hover:underline">Go back</button>
    </div>
  );

  const activePipelineId =
    venueCustomer?.pipeline_id
    ?? venueCustomer?.pipeline_context?.pipelineId
    ?? pipelines.find((p) => p.is_default)?.id
    ?? pipelines[0]?.id;

  const activeStages =
    pipelines.find((p) => p.id === activePipelineId)?.stages ?? [];

  const currentStageId =
    venueCustomer?.stage_id
    ?? venueCustomer?.pipeline_context?.stageId
    ?? null;

  const currentStageMeta = activeStages.find((s) => s.id === currentStageId);

  // ── Reusable inline-edit Save/Cancel footer ───────────────────────────────
  function EditFooter({ onCancel, onSave, saving, error: err }: { onCancel: () => void; onSave: () => void; saving: boolean; error: string }) {
    return (
      <>
        {err && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={12} />{err}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
          <button type="button" onClick={onSave} disabled={saving} className="flex-1 rounded-xl py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50" style={{backgroundColor:'#1b1b1b'}}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </>
    );
  }

  return (
    <div>
      {/* Back */}
      <button onClick={() => router.push('/dashboard/customers')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-6">
        <ArrowLeft size={16} /> Back to Customers
      </button>

      {/* ── Header card ── */}
      <div className="rounded-2xl border border-gray-200 bg-white mb-6 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full flex items-center justify-center text-lg font-semibold text-white flex-shrink-0"
              style={{ backgroundColor: '#1b1b1b' }}>
              {customer.name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-heading text-xl text-gray-900">{customer.name}</h1>
                {venueCustomer && (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${currentStageMeta ? 'border-transparent' : 'border-gray-200 bg-gray-100 text-gray-700'}`}
                    style={
                      currentStageMeta
                        ? {
                          backgroundColor: `${currentStageMeta.color}22`,
                          color: currentStageMeta.color,
                          borderColor: `${currentStageMeta.color}44`,
                        }
                        : undefined
                    }
                  >
                    {currentStageMeta?.name ?? venueCustomer.pipeline_stage.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-0.5">
                {customer.email && <span className="flex items-center gap-1 text-sm text-gray-500"><Mail size={13} />{customer.email}</span>}
                {customer.phone && <span className="flex items-center gap-1 text-sm text-gray-500"><Phone size={13} />{customer.phone}</span>}
                {venueCustomer?.referral_source && <span className="text-xs text-gray-400 border border-gray-200 rounded-full px-2 py-0.5">via {venueCustomer.referral_source}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={startEditContact}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              <Pencil size={13} /> Edit
            </button>
            <Link href={`/dashboard/payments/new?type=proposal&email=${encodeURIComponent(customer.email || '')}&name=${encodeURIComponent(customer.name || '')}`}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors"
              style={{ backgroundColor: '#1b1b1b' }}>
              <Plus size={14} /> New Proposal
            </Link>
            <Link href={`/dashboard/payments/new?type=invoice&email=${encodeURIComponent(customer.email || '')}&name=${encodeURIComponent(customer.name || '')}`}
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
              <Plus size={14} /> New Invoice
            </Link>
          </div>
        </div>

        {/* Pipeline + stage (same data as Leads Kanban; default pipeline until changed) */}
        {venueCustomer && pipelines.length > 0 && (
          <div className="px-5 py-3 border-b border-gray-100 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Pipeline</span>
              <select
                value={activePipelineId ?? ''}
                onChange={(e) => void changePipeline(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-800 focus:border-gray-400 focus:outline-none max-w-[220px]"
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
              {venueCustomer.pipeline_context?.linkedLeadId && (
                <span className="text-[10px] text-gray-400">Linked to lead — stage syncs both ways</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mr-1">Stage</span>
              {activeStages.map((st) => {
                const active = currentStageId === st.id;
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => void updateStage(st.id)}
                    className="rounded-full px-3 py-1 text-xs font-medium border transition-colors"
                    style={
                      active
                        ? {
                          backgroundColor: `${st.color}22`,
                          color: st.color,
                          borderColor: `${st.color}55`,
                        }
                        : { borderColor: '#e5e7eb', color: '#6b7280' }
                    }
                  >
                    {st.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-gray-100">
          {[
            { label: 'Proposals',   value: proposals.length,           color: 'text-gray-900' },
            { label: 'Total Paid',  value: formatCents(totalPaid),     color: 'text-emerald-600' },
            { label: 'Pending',     value: formatCents(totalPending),  color: 'text-amber-600' },
            { label: 'Open Tasks',  value: openTasks.length,           color: openTasks.length > 0 ? 'text-orange-600' : 'text-gray-900' },
          ].map(kpi => (
            <div key={kpi.label} className="px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{kpi.label}</p>
              <p className={`mt-1 text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Contact edit modal ── */}
      {editingContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-heading text-lg font-semibold text-gray-900">Edit Contact Info</h2>
              <button onClick={() => setEditingContact(false)} className="text-gray-400 hover:text-gray-600"><XIcon size={18} /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[{k:'firstName',l:'First Name'},{k:'lastName',l:'Last Name'}].map(f => (
                  <div key={f.k}>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{f.l}</label>
                    <input value={editForm[f.k as keyof typeof editForm]} onChange={e => setEditForm(p => ({...p,[f.k]:e.target.value}))}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none" />
                  </div>
                ))}
              </div>
              {[{k:'email',l:'Email',t:'email'},{k:'phone',l:'Phone',t:'tel'},{k:'address',l:'Address',t:'text'}].map(f => (
                <div key={f.k}>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{f.l}</label>
                  <input type={f.t} value={editForm[f.k as keyof typeof editForm]} onChange={e => setEditForm(p => ({...p,[f.k]:e.target.value}))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none" />
                </div>
              ))}
              <div className="grid grid-cols-3 gap-3">
                {[{k:'city',l:'City'},{k:'state',l:'State'},{k:'zip',l:'ZIP'}].map(f => (
                  <div key={f.k}>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{f.l}</label>
                    <input value={editForm[f.k as keyof typeof editForm]} onChange={e => setEditForm(p => ({...p,[f.k]:e.target.value}))}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none" />
                  </div>
                ))}
              </div>
              <EditFooter onCancel={() => setEditingContact(false)} onSave={saveContact} saving={savingContact} error={contactError} />
            </div>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex flex-wrap gap-1 mb-6 border-b border-gray-200">
        {([
          { id: 'overview',   label: 'Overview',                                                      icon: User },
          { id: 'notes',      label: `Notes${notes.length > 0 ? ` (${notes.length})` : ''}`,         icon: ClipboardList },
          { id: 'timeline',   label: 'Activity',                                                      icon: Activity },
          { id: 'payments',   label: 'Payments',                                                      icon: Receipt },
          { id: 'tasks',      label: `Tasks${openTasks.length > 0 ? ` (${openTasks.length})` : ''}`, icon: ClipboardList },
          { id: 'documents',  label: `Documents${files.length > 0 ? ` (${files.length})` : ''}`,     icon: FileCheck },
        ] as { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[]).map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as Tab)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === tab.id ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              <Icon size={14} />{tab.label}
            </button>
          );
        })}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Contact info (read-only display — edit via modal above) */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-base text-gray-900 flex items-center gap-2"><User size={15} /> Contact Info</h2>
              <button onClick={startEditContact} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"><Pencil size={11} /> Edit</button>
            </div>
            <div className="space-y-2 text-sm">
              {customer.email && <div className="flex items-center gap-2 text-gray-700"><Mail size={13} className="text-gray-400 flex-shrink-0" />{customer.email}</div>}
              {customer.phone && <div className="flex items-center gap-2 text-gray-700"><Phone size={13} className="text-gray-400 flex-shrink-0" />{customer.phone}</div>}
              {(customer.address || customer.city) && <div className="flex items-center gap-2 text-gray-700"><MapPin size={13} className="text-gray-400 flex-shrink-0" />{[customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(', ')}</div>}
              {!customer.email && !customer.phone && <p className="text-gray-400 text-xs">No contact info</p>}
            </div>
          </div>

          {/* Partner / Second Contact */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-base text-gray-900 flex items-center gap-2"><Heart size={15} /> Partner / Second Contact</h2>
              <button onClick={startEditPartner} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"><Pencil size={11} /> {venueCustomer?.partner_first_name ? 'Edit' : 'Add'}</button>
            </div>
            {editingPartner ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {[{k:'partner_first_name',l:'First Name'},{k:'partner_last_name',l:'Last Name'}].map(f => (
                    <div key={f.k}>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{f.l}</label>
                      <input value={partnerForm[f.k as keyof typeof partnerForm]} onChange={e => setPartnerForm(p => ({...p,[f.k]:e.target.value}))}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none" />
                    </div>
                  ))}
                </div>
                {[{k:'partner_email',l:'Email',t:'email'},{k:'partner_phone',l:'Phone',t:'tel'}].map(f => (
                  <div key={f.k}>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{f.l}</label>
                    <input type={f.t} value={partnerForm[f.k as keyof typeof partnerForm]} onChange={e => setPartnerForm(p => ({...p,[f.k]:e.target.value}))}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none" />
                  </div>
                ))}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Referral Source</label>
                  <select value={partnerForm.referral_source} onChange={e => setPartnerForm(p => ({...p,referral_source:e.target.value}))}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none">
                    <option value="">Unknown</option>
                    {REFERRAL_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <EditFooter onCancel={() => setEditingPartner(false)} onSave={savePartner} saving={savingPartner} error={partnerError} />
              </div>
            ) : venueCustomer?.partner_first_name ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-700"><User size={13} className="text-gray-400" />{[venueCustomer.partner_first_name, venueCustomer.partner_last_name].filter(Boolean).join(' ')}</div>
                {venueCustomer.partner_email && <div className="flex items-center gap-2 text-gray-700"><Mail size={13} className="text-gray-400" />{venueCustomer.partner_email}</div>}
                {venueCustomer.partner_phone && <div className="flex items-center gap-2 text-gray-700"><Phone size={13} className="text-gray-400" />{venueCustomer.partner_phone}</div>}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No partner info yet.{' '}
                <button onClick={startEditPartner} className="text-blue-600 hover:underline">Add partner</button>
              </p>
            )}
          </div>

          {/* Wedding details */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-base text-gray-900 flex items-center gap-2"><Calendar size={15} /> Wedding Details</h2>
              {!editingWedding && (
                <button onClick={startEditWedding} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"><Pencil size={11} /> {(venueCustomer?.wedding_date || venueCustomer?.guest_count) ? 'Edit' : 'Add'}</button>
              )}
            </div>
            {editingWedding ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    { k:'wedding_date',      l:'Wedding Date',    t:'date' },
                    { k:'rehearsal_date',    l:'Rehearsal Date',  t:'date' },
                    { k:'guest_count',       l:'Guest Count',     t:'number' },
                    { k:'coordinator_name',  l:'Day-of Coordinator Name', t:'text' },
                    { k:'coordinator_phone', l:'Coordinator Phone',        t:'tel' },
                  ].map(f => (
                    <div key={f.k}>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{f.l}</label>
                      <input type={f.t} value={weddingForm[f.k as keyof typeof weddingForm]} onChange={e => setWeddingForm(p => ({...p,[f.k]:e.target.value}))}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none" />
                    </div>
                  ))}
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Ceremony Type</label>
                    <select value={weddingForm.ceremony_type} onChange={e => setWeddingForm(p => ({...p,ceremony_type:e.target.value}))}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none">
                      <option value="">Not set</option>
                      {CEREMONY_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Space</label>
                    <select value={weddingForm.wedding_space_id} onChange={e => setWeddingForm(p => ({...p,wedding_space_id:e.target.value}))}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none">
                      <option value="">Not assigned</option>
                      {spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Catering Notes</label>
                  <textarea value={weddingForm.catering_notes} onChange={e => setWeddingForm(p => ({...p,catering_notes:e.target.value}))} rows={2}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none resize-none" />
                </div>
                <EditFooter onCancel={() => setEditingWedding(false)} onSave={saveWedding} saving={savingWedding} error={weddingError} />
              </div>
            ) : venueCustomer && (venueCustomer.wedding_date || venueCustomer.guest_count || venueCustomer.ceremony_type) ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
                {venueCustomer.wedding_date && <div><p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider mb-0.5">Wedding Date</p><p className="text-gray-900 font-medium">{formatDate(venueCustomer.wedding_date)}</p></div>}
                {venueCustomer.ceremony_type && <div><p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider mb-0.5">Type</p><p className="text-gray-900 font-medium">{CEREMONY_TYPES.find(c => c.value === venueCustomer.ceremony_type)?.label ?? venueCustomer.ceremony_type}</p></div>}
                {venueCustomer.guest_count && <div><p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider mb-0.5">Guests</p><p className="text-gray-900 font-medium">{venueCustomer.guest_count}</p></div>}
                {venueCustomer.venue_spaces && <div><p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider mb-0.5">Space</p><p className="text-gray-900 font-medium flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{backgroundColor:venueCustomer.venue_spaces.color}} />{venueCustomer.venue_spaces.name}</p></div>}
                {venueCustomer.rehearsal_date && <div><p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider mb-0.5">Rehearsal</p><p className="text-gray-900 font-medium">{formatDate(venueCustomer.rehearsal_date)}</p></div>}
                {venueCustomer.coordinator_name && <div><p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider mb-0.5">Coordinator</p><p className="text-gray-900 font-medium">{venueCustomer.coordinator_name}{venueCustomer.coordinator_phone && <span className="text-gray-500 font-normal"> · {venueCustomer.coordinator_phone}</span>}</p></div>}
                {venueCustomer.catering_notes && <div className="sm:col-span-2 lg:col-span-4"><p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider mb-0.5">Catering Notes</p><p className="text-gray-700">{venueCustomer.catering_notes}</p></div>}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No wedding details yet.{' '}
                <button onClick={startEditWedding} className="text-blue-600 hover:underline">Add details</button>
              </p>
            )}
          </div>

          {/* ── Venue Spaces ── */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-heading text-base text-gray-900 flex items-center gap-2">
                <Calendar size={15} /> Venue Spaces
              </h2>
              <button onClick={() => setShowSpaceManager(v => !v)}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors">
                <Pencil size={11} /> {showSpaceManager ? 'Done' : 'Manage'}
              </button>
            </div>

            {/* Space list */}
            {spaces.length === 0 && !showSpaceManager && (
              <p className="text-xs text-gray-400">
                No spaces yet.{' '}
                <button onClick={() => setShowSpaceManager(true)} className="text-blue-600 hover:underline">Add a space</button>
              </p>
            )}
            {spaces.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {spaces.map(s => (
                  <div key={s.id} className="flex items-center gap-1.5 rounded-full border border-gray-200 pl-2 pr-1 py-1">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-xs text-gray-700 font-medium">{s.name}</span>
                    {s.capacity ? <span className="text-[10px] text-gray-400">({s.capacity})</span> : null}
                    {showSpaceManager && (
                      <button onClick={() => removeSpace(s.id)}
                        className="ml-0.5 rounded-full w-4 h-4 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <XIcon size={10} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add space form */}
            {showSpaceManager && (
              <div className="border-t border-gray-100 pt-3 mt-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Add Space</p>
                <div className="flex flex-wrap gap-2 items-end">
                  <input value={newSpaceName} onChange={e => setNewSpaceName(e.target.value)}
                    placeholder="e.g. Barn, Garden, Ballroom"
                    onKeyDown={e => e.key === 'Enter' && addSpace()}
                    className="flex-1 min-w-[140px] rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none" />
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-gray-400">Color</label>
                    <input type="color" value={newSpaceColor} onChange={e => setNewSpaceColor(e.target.value)}
                      className="h-8 w-10 rounded border border-gray-200 cursor-pointer" />
                  </div>
                  <input type="number" value={newSpaceCap} onChange={e => setNewSpaceCap(e.target.value)}
                    placeholder="Capacity"
                    className="w-24 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none" />
                  <button onClick={addSpace} disabled={!newSpaceName.trim() || savingSpace}
                    className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-40"
                    style={{ backgroundColor: '#1b1b1b' }}>
                    {savingSpace ? <Loader2 size={14} className="animate-spin inline" /> : 'Add'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── NOTES TAB ── */}
      {activeTab === 'notes' && (
        <div className="max-w-2xl">
          <h2 className="font-heading text-lg text-gray-900 mb-5">Notes</h2>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 mb-5">
            <textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Add a note…" rows={3}
              className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none resize-none mb-3" />
            {noteError && <p className="text-xs text-red-600 flex items-center gap-1 mb-2"><AlertCircle size={12} />{noteError}</p>}
            <button onClick={addNote} disabled={savingNote || !newNote.trim()}
              className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-40"
              style={{backgroundColor:'#1b1b1b'}}>
              {savingNote ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}
              {savingNote ? 'Saving…' : 'Add Note'}
            </button>
          </div>
          <div className="space-y-3">
            {notes.length === 0 && <p className="text-sm text-gray-400">No notes yet.</p>}
            {notes.map(n => (
              <div key={n.id} className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 group relative">
                {editingNoteId === n.id ? (
                  <>
                    <textarea
                      value={editNoteContent}
                      onChange={e => setEditNoteContent(e.target.value)}
                      rows={3}
                      autoFocus
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none resize-none"
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={saveEditNote}
                        disabled={savingEditNote || !editNoteContent.trim()}
                        className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 transition-colors disabled:opacity-40"
                      >
                        {savingEditNote ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => { setEditingNoteId(null); setEditNoteContent(''); }}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{n.content}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <p className="text-[11px] text-gray-400">{n.author_name ? `${n.author_name} · ` : ''}{formatDateTime(n.created_at)}</p>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => { setEditingNoteId(n.id); setEditNoteContent(n.content); }}
                          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-700 transition-all"
                          title="Edit note"
                        >
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => deleteNote(n.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"><Trash2 size={13} /></button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ACTIVITY TAB ── */}
      {activeTab === 'timeline' && (
        <div className="max-w-2xl">
          <h2 className="font-heading text-lg text-gray-900 mb-5">Activity Timeline</h2>
          {activity.length === 0 ? (
            <p className="text-sm text-gray-400">No activity recorded yet. Activity is logged automatically as you interact with this customer.</p>
          ) : (
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-200" />
              <div className="space-y-4">
                {activity.map(a => (
                  <div key={a.id} className="flex gap-4">
                    <div className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full border-2 border-white shadow-sm bg-gray-100 flex items-center justify-center text-gray-500">
                      {ACTIVITY_ICONS[a.activity_type] ?? <Info size={13} />}
                    </div>
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

      {/* ── PAYMENTS TAB ── */}
      {activeTab === 'payments' && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="font-heading text-lg text-gray-900">Proposals & Invoices</h2>
            <input type="text" value={proposalSearch} onChange={e => setProposalSearch(e.target.value)}
              placeholder="Search…"
              className="rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none w-48" />
          </div>
          <div className="overflow-x-auto rounded-2xl border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  {['Status','Amount','Type','Sent','Signed','Paid','Actions'].map(h => (
                    <th key={h} className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {(() => {
                  const filtered = [...proposals]
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .filter(p => !proposalSearch || [p.status, p.payment_type, p.created_at].some(v => v?.toLowerCase().includes(proposalSearch.toLowerCase())));
                  if (filtered.length === 0) return <tr><td colSpan={7} className="px-5 py-10 text-center text-gray-400">No proposals found</td></tr>;
                  return filtered.map(p => {
                    const color = getStatusColor(p.status);
                    return (
                      <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3.5"><span className={classNames('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', color.bg, color.text)}>{p.status}</span></td>
                        <td className="px-5 py-3.5 text-gray-700">{formatCents(p.price)}</td>
                        <td className="px-5 py-3.5 text-gray-700 capitalize">{p.payment_type}</td>
                        <td className="px-5 py-3.5 text-gray-500">{p.sent_at ? formatDate(p.sent_at) : '—'}</td>
                        <td className="px-5 py-3.5 text-gray-500">{p.signed_at ? formatDate(p.signed_at) : '—'}</td>
                        <td className="px-5 py-3.5 text-gray-500">{p.paid_at ? formatDate(p.paid_at) : '—'}</td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1">
                            <Link href={`/dashboard/proposals/${p.id}/edit`} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"><Pencil size={13} /></Link>
                            {p.status !== 'paid' && <button onClick={() => handleResend(p)} disabled={resendingId === p.id} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors disabled:opacity-50"><RefreshCw size={13} className={resendingId === p.id ? 'animate-spin' : ''} /></button>}
                            <button onClick={() => copyLink(p)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"><Copy size={13} />{copiedId === p.id && <span className="ml-1 text-[10px]">Copied!</span>}</button>
                            <Link href={`/proposal/${p.public_token}`} target="_blank" className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"><ExternalLink size={13} /></Link>
                            {p.status === 'paid' && <Link href={`/invoice/${p.id}`} target="_blank" className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"><Receipt size={13} /></Link>}
                            {p.status === 'paid' && <button onClick={() => setRefundTarget(p)} className="rounded-md p-1.5 text-red-500 hover:bg-red-50 transition-colors"><RotateCcw size={13} /></button>}
                          </div>
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
          {installmentProps.length > 0 && (
            <div className="mt-8">
              <h2 className="font-heading text-lg text-gray-900 mb-4">Payment Schedules</h2>
              <div className="space-y-4">
                {installmentProps.map(p => {
                  const config = p.payment_config as { installments?: { amount: number; date: string }[] } | null;
                  const insts  = config?.installments || [];
                  return (
                    <div key={p.id} className="rounded-2xl border border-gray-200 p-5">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-medium text-gray-900">Installment Plan — {formatCents(p.price)}</p>
                        <span className={classNames('rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', getStatusColor(p.status).bg, getStatusColor(p.status).text)}>{p.status}</span>
                      </div>
                      {insts.map((inst, i) => (
                        <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                          <span className="text-gray-500">Payment {i + 1}</span>
                          <div className="flex items-center gap-4">
                            <span className="text-gray-700">{formatCents(inst.amount)}</span>
                            <span className="text-gray-400 text-xs">{inst.date ? formatDate(inst.date) : '—'}</span>
                            {i === 0 && p.status === 'paid' && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Paid</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TASKS TAB ── */}
      {activeTab === 'tasks' && (
        <div className="max-w-2xl">
          <h2 className="font-heading text-lg text-gray-900 mb-5">Tasks</h2>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 mb-5">
            <div className="flex gap-2 mb-2">
              <input value={newTask} onChange={e => setNewTask(e.target.value)} placeholder="New task…"
                onKeyDown={e => e.key === 'Enter' && !savingTask && addTask()}
                className="flex-1 rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none" />
              <input type="date" value={newTaskDue} onChange={e => setNewTaskDue(e.target.value)}
                className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none w-36" />
              <button onClick={addTask} disabled={savingTask || !newTask.trim()}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-40"
                style={{backgroundColor:'#1b1b1b'}}>
                {savingTask ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />}
              </button>
            </div>
            {taskError && <p className="text-xs text-red-600 flex items-center gap-1 mt-1"><AlertCircle size={12} />{taskError}</p>}
          </div>

          <div className="space-y-2">
            {openTasks.length === 0 && <p className="text-sm text-gray-400 py-4">No open tasks.</p>}
            {openTasks.map(t => (
              <div key={t.id} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 group">
                <button onClick={() => toggleTask(t)}
                  className="mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 border-gray-300 hover:border-emerald-400 transition-colors flex items-center justify-center">
                  <span className="sr-only">Complete</span>
                </button>
                {editingTaskId === t.id ? (
                  <div className="flex-1 min-w-0 flex flex-wrap gap-2">
                    <input
                      value={editTaskTitle}
                      onChange={e => setEditTaskTitle(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !savingEditTask) saveEditTask();
                        if (e.key === 'Escape') { setEditingTaskId(null); setEditTaskTitle(''); setEditTaskDue(''); }
                      }}
                      autoFocus
                      className="flex-1 min-w-[140px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                    />
                    <input
                      type="date"
                      value={editTaskDue}
                      onChange={e => setEditTaskDue(e.target.value)}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none w-36"
                    />
                    <button
                      onClick={saveEditTask}
                      disabled={savingEditTask || !editTaskTitle.trim()}
                      className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 transition-colors disabled:opacity-40"
                    >
                      {savingEditTask ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setEditingTaskId(null); setEditTaskTitle(''); setEditTaskDue(''); }}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900">{t.title}</p>
                      {t.due_date && (
                        <p className={`text-xs mt-0.5 ${new Date(t.due_date) < new Date() ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                          Due {formatDate(t.due_date)}
                        </p>
                      )}
                    </div>
                    <button onClick={() => toggleTask(t)} className="opacity-0 group-hover:opacity-100 text-xs text-emerald-600 hover:text-emerald-700 font-medium transition-all flex items-center gap-1">
                      <Check size={12} /> Done
                    </button>
                    <button
                      onClick={() => {
                        setEditingTaskId(t.id);
                        setEditTaskTitle(t.title);
                        setEditTaskDue(t.due_date ?? '');
                      }}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-700 transition-all"
                      title="Edit task"
                    >
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => deleteTask(t.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all">
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {completedTasks.length > 0 && (
            <div className="mt-5">
              <button onClick={() => setShowCompleted(v => !v)}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                {showCompleted ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {completedTasks.length} completed task{completedTasks.length !== 1 ? 's' : ''}
              </button>
              {showCompleted && (
                <div className="mt-2 space-y-2">
                  {completedTasks.map(t => (
                    <div key={t.id} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 group opacity-60 hover:opacity-100 transition-opacity">
                      <button onClick={() => toggleTask(t)}
                        title="Reopen task"
                        className="mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 border-emerald-400 bg-emerald-50 hover:bg-white hover:border-gray-400 flex items-center justify-center transition-colors">
                        <Check size={10} className="text-emerald-500 group-hover:opacity-40 transition-opacity" />
                        <span className="sr-only">Reopen task</span>
                      </button>
                      <div className="flex-1">
                        <p className="text-sm text-gray-500 line-through group-hover:no-underline group-hover:text-gray-700 transition-colors">{t.title}</p>
                        {t.completed_at && <p className="text-xs text-gray-400 mt-0.5">Completed {formatDate(t.completed_at)}</p>}
                      </div>
                      <button onClick={() => toggleTask(t)} className="opacity-0 group-hover:opacity-100 text-xs text-gray-600 hover:text-gray-900 font-medium transition-all flex items-center gap-1">
                        <Undo2 size={12} /> Reopen
                      </button>
                      <button onClick={() => deleteTask(t.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── DOCUMENTS TAB ── */}
      {activeTab === 'documents' && (
        <div>
          <h2 className="font-heading text-lg text-gray-900 mb-5">Documents</h2>
          <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50/50 p-5 mb-5">
            <div className="flex flex-wrap items-center gap-3">
              <select value={uploadType} onChange={e => setUploadType(e.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none capitalize">
                {FILE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
              <label className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white cursor-pointer transition-colors ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`} style={{backgroundColor:'#1b1b1b'}}>
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading ? 'Uploading…' : 'Upload File'}
                <input type="file" className="hidden" disabled={uploading} onChange={handleFileUpload}
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xlsx,.csv" />
              </label>
              <p className="text-xs text-gray-400">PDF, Word, Excel, images up to 10MB</p>
            </div>
            {uploadError && <p className="text-xs text-red-600 flex items-center gap-1 mt-2"><AlertCircle size={12} />{uploadError}</p>}
          </div>

          {files.length === 0 ? (
            <p className="text-sm text-gray-400">No documents yet.</p>
          ) : (
            <div className="rounded-2xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/60">
                    {['File','Type','Status','Uploaded','Actions'].map(h => (
                      <th key={h} className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {files.map(f => (
                    <tr key={f.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-3.5">
                        {f.url ? (
                          <a href={f.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1.5">
                            <FileCheck size={13} />{f.filename}
                          </a>
                        ) : (
                          <span className="flex items-center gap-1.5 text-gray-700"><FileCheck size={13} />{f.filename}</span>
                        )}
                        {f.file_size && <p className="text-[11px] text-gray-400 mt-0.5">{(f.file_size / 1024).toFixed(0)} KB{f.uploaded_by ? ` · ${f.uploaded_by}` : ''}</p>}
                      </td>
                      <td className="px-5 py-3.5 text-gray-600 capitalize">{f.file_type.replace(/_/g, ' ')}</td>
                      <td className="px-5 py-3.5">
                        <select value={f.file_status} onChange={e => updateFileStatus(f.id, e.target.value)}
                          className={`rounded-full border-0 px-2.5 py-1 text-xs font-semibold cursor-pointer focus:outline-none capitalize ${FILE_STATUS_COLORS[f.file_status] ?? 'bg-gray-100 text-gray-700'}`}>
                          {FILE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-5 py-3.5 text-gray-500">{formatDate(f.created_at)}</td>
                      <td className="px-5 py-3.5">
                        <button onClick={() => deleteFile(f.id)} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Refund Modal */}
      {refundTarget && (
        <RefundModal
          proposalId={refundTarget.id}
          chargeId={refundTarget.charge_id}
          customerName={refundTarget.customer_name || customer?.name || 'Customer'}
          originalAmount={refundTarget.price}
          onSuccess={(fullRefund) => {
            if (fullRefund) setProposals(p => p.map(x => x.id === refundTarget.id ? { ...x, status: 'refunded' } : x));
            setRefundTarget(null);
          }}
          onClose={() => setRefundTarget(null)}
        />
      )}
    </div>
  );
}
