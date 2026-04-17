'use client';

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties,
} from 'react';
import {
  Inbox, Loader2, Search, Mail, Phone, Calendar as CalendarIcon, Users,
  MessageSquare, Trash2, ExternalLink, UserPlus,
  LayoutGrid, List as ListIcon, Plus, Settings2, X, Pencil, DollarSign,
  Globe, CalendarPlus, Clock, GripVertical, ArrowLeft, ArrowRight,
  ChevronDown, Filter,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type StageKind = 'open' | 'won' | 'lost';

interface Stage {
  id: string;
  pipeline_id: string;
  venue_id: string;
  name: string;
  color: string;
  kind: StageKind;
  position: number;
}

interface Pipeline {
  id: string;
  venue_id: string;
  name: string;
  is_default: boolean;
  position: number;
  stages: Stage[];
}

type LeadStatus =
  | 'new' | 'contacted' | 'tour_booked' | 'proposal_sent'
  | 'booked_wedding' | 'not_interested';

interface Lead {
  id: string;
  venue_id: string;
  listing_slug: string | null;
  listing_name: string | null;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  wedding_date: string | null;
  guest_count: number | null;
  booking_timeline: string | null;
  message: string | null;
  notes: string | null;
  status: LeadStatus;
  source: string;
  created_at: string;
  updated_at: string | null;
  venue_name: string | null;
  venue_website_url: string | null;
  opportunity_value: number | null;
  pipeline_id: string | null;
  stage_id: string | null;
  position: number;
  note_count: number;
  booking_badge?: { iso: string; variant: 'wedding' | 'appointment' } | null;
}

interface LeadNote {
  id: string;
  lead_id: string;
  content: string;
  author_name: string | null;
  created_at: string;
}

interface Space { id: string; name: string; color: string; }

type ViewMode = 'kanban' | 'list';

const DIRECTORY_URL = process.env.NEXT_PUBLIC_DIRECTORY_URL ?? 'https://storyvenue.com';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function formatMoney(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(n);
}

function displayName(lead: Lead): string {
  const composed = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim();
  return composed || lead.name || 'Unnamed lead';
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = (full || '').trim().split(/\s+/);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// Contrast helper — pick white vs dark text for a stage chip color.
function readableOn(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return '#111827';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? '#111827' : '#ffffff';
}

/** Pill text like "Apr 20th, 9:30 am" (appointment) or "Apr 20, 2026" (wedding date). */
function formatBookingPillText(iso: string, variant: 'wedding' | 'appointment'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (variant === 'wedding') {
    const dayPart = iso.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dayPart)) {
      const [y, m, day] = dayPart.split('-').map(Number);
      return new Date(y, m - 1, day).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
      });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const day = d.getDate();
  const ord =
    day % 10 === 1 && day !== 11 ? 'st'
      : day % 10 === 2 && day !== 12 ? 'nd'
        : day % 10 === 3 && day !== 13 ? 'rd'
          : 'th';
  const month = d.toLocaleString(undefined, { month: 'short' });
  const t = d
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s/g, ' ')
    .toLowerCase();
  return `${month} ${day}${ord}, ${t}`;
}

// ─── Default empty draft for the new-lead form ───────────────────────────────

type LeadDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  venueName: string;
  venueWebsiteUrl: string;
  opportunityValue: string;
  weddingDate: string;
  guestCount: string;
  bookingTimeline: string;
  message: string;
  pipelineId: string;
  stageId: string;
};

const emptyDraft = (pipelineId: string): LeadDraft => ({
  firstName: '', lastName: '', email: '', phone: '',
  venueName: '', venueWebsiteUrl: '', opportunityValue: '',
  weddingDate: '', guestCount: '', bookingTimeline: '', message: '',
  pipelineId,
  stageId: '',
});

// ─── Main page ───────────────────────────────────────────────────────────────

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('kanban');
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<string | 'all'>('all');

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [addingOpen, setAddingOpen] = useState(false);

  const activePipeline = useMemo(
    () => pipelines.find((p) => p.id === activePipelineId) ?? null,
    [pipelines, activePipelineId],
  );

  // ─── Loading ───────────────────────────────────────────────────────────────

  const loadPipelines = useCallback(async () => {
    const res = await fetch('/api/pipelines', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    setPipelines(data.pipelines ?? []);
    setActivePipelineId((prev) => {
      if (prev && (data.pipelines ?? []).some((p: Pipeline) => p.id === prev)) return prev;
      const def = (data.pipelines ?? []).find((p: Pipeline) => p.is_default);
      return def?.id ?? data.pipelines?.[0]?.id ?? null;
    });
  }, []);

  const loadLeads = useCallback(async () => {
    if (!activePipelineId) return;
    setLoading(true);
    const params = new URLSearchParams();
    params.set('pipeline_id', activePipelineId);
    if (query.trim()) params.set('q', query.trim());
    if (stageFilter !== 'all') params.set('stage_id', stageFilter);
    const res = await fetch(`/api/leads?${params.toString()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setLeads(data.leads ?? []);
    }
    setLoading(false);
  }, [activePipelineId, query, stageFilter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadPipelines(); }, [loadPipelines]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadLeads(); }, [loadLeads]);

  // Debounce search — we don't want to refetch on every keystroke.
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onQueryChange = (next: string) => {
    setQuery(next);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => { loadLeads(); }, 250);
  };

  // ─── Lead mutations ────────────────────────────────────────────────────────

  async function updateLead(id: string, patch: Record<string, unknown>, optimistic = true) {
    if (optimistic) {
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } as Lead : l)));
    }
    const res = await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...data.lead } as Lead : l)));
      if (selectedLead?.id === id) setSelectedLead((prev) => (prev ? { ...prev, ...data.lead } : prev));
    }
  }

  async function deleteLead(id: string) {
    if (!confirm('Delete this lead? This cannot be undone.')) return;
    const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setLeads((prev) => prev.filter((l) => l.id !== id));
      if (selectedLead?.id === id) { setSelectedLead(null); setEditorOpen(false); }
    }
  }

  async function createLead(draft: LeadDraft) {
    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName:         draft.firstName,
        lastName:          draft.lastName,
        email:             draft.email,
        phone:             draft.phone,
        venueName:         draft.venueName,
        venueWebsiteUrl:   draft.venueWebsiteUrl,
        opportunityValue: draft.opportunityValue ? Number(draft.opportunityValue) : null,
        weddingDate:       draft.weddingDate || null,
        guestCount:        draft.guestCount ? Number(draft.guestCount) : null,
        bookingTimeline:   draft.bookingTimeline.trim() || undefined,
        message:           draft.message,
        pipelineId:        draft.pipelineId || activePipelineId,
        stageId:           draft.stageId || undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Failed to create lead');
      return;
    }
    await loadLeads();
    setAddingOpen(false);
  }

  async function convertToCustomer(lead: Lead) {
    const { firstName, lastName } = splitName(displayName(lead));
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: firstName || 'Customer',
        lastName:  lastName || firstName || 'Lead',
        email:     lead.email,
        phone:     lead.phone ?? '',
      }),
    });
    if (res.ok) {
      alert('Customer created from this lead.');
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Failed to create customer');
    }
  }

  // ─── Kanban drag & drop ────────────────────────────────────────────────────

  const [dragLeadId, setDragLeadId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  function onDragStart(e: React.DragEvent, leadId: string) {
    setDragLeadId(leadId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/lead-id', leadId);
  }
  function onDragEnd() { setDragLeadId(null); setDragOverStage(null); }
  function onDragOverStage(e: React.DragEvent, stageId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverStage !== stageId) setDragOverStage(stageId);
  }
  async function onDropStage(e: React.DragEvent, stageId: string) {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/lead-id') || dragLeadId;
    setDragOverStage(null);
    setDragLeadId(null);
    if (!leadId) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage_id === stageId) return;
    await updateLead(leadId, { stageId });
  }

  // ─── Grouping leads by stage for Kanban ────────────────────────────────────

  const leadsByStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    if (!activePipeline) return map;
    for (const s of activePipeline.stages) map.set(s.id, []);
    const orphans: Lead[] = [];
    for (const lead of leads) {
      if (lead.stage_id && map.has(lead.stage_id)) {
        map.get(lead.stage_id)!.push(lead);
      } else {
        orphans.push(lead);
      }
    }
    // Drop orphans into the first stage so nothing disappears.
    if (orphans.length > 0 && activePipeline.stages[0]) {
      map.get(activePipeline.stages[0].id)!.push(...orphans);
    }
    return map;
  }, [leads, activePipeline]);

  const totalValueByStage = useMemo(() => {
    const tot = new Map<string, number>();
    for (const [stageId, list] of leadsByStage) {
      tot.set(stageId, list.reduce((s, l) => s + (l.opportunity_value ?? 0), 0));
    }
    return tot;
  }, [leadsByStage]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-gray-900 flex items-center gap-2">
            <Inbox className="w-6 h-6" /> Leads
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Your sales pipeline. Drag cards between stages, add notes, and schedule appointments.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PipelineControls
            pipelines={pipelines}
            activeId={activePipelineId}
            onChange={setActivePipelineId}
            onManage={() => setEditorOpen(true)}
          />
          <div className="inline-flex rounded-2xl border border-gray-200 bg-white p-0.5">
            <button
              onClick={() => setView('kanban')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                view === 'kanban' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Kanban
            </button>
            <button
              onClick={() => setView('list')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                view === 'list' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <ListIcon className="w-3.5 h-3.5" /> List
            </button>
          </div>
          <button
            onClick={() => setAddingOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-2xl px-3 py-1.5 text-xs font-medium text-white transition-colors"
            style={{ backgroundColor: '#1b1b1b' }}
          >
            <Plus className="w-3.5 h-3.5" /> Add Lead
          </button>
        </div>
      </header>

      {pipelines.length > 1 && (
        <PipelineTabs
          pipelines={pipelines}
          activeId={activePipelineId}
          onChange={setActivePipelineId}
        />
      )}

      {/* Search + filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search name, email, phone, venue, URL, notes…"
            className="w-full rounded-2xl border border-gray-200 bg-white pl-9 pr-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
          />
        </div>
        {view === 'list' && activePipeline && (
          <div className="relative">
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="appearance-none rounded-2xl border border-gray-200 bg-white pl-9 pr-8 py-2 text-sm focus:border-gray-400 focus:outline-none"
            >
              <option value="all">All stages</option>
              {activePipeline.stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      )}

      {!loading && !activePipeline && (
        <div className="rounded-3xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Setting up your first pipeline…
        </div>
      )}

      {!loading && activePipeline && view === 'kanban' && (
        <KanbanBoard
          pipeline={activePipeline}
          leadsByStage={leadsByStage}
          totalValueByStage={totalValueByStage}
          dragLeadId={dragLeadId}
          dragOverStage={dragOverStage}
          onCardClick={(l) => setSelectedLead(l)}
          onDragStartCard={onDragStart}
          onDragEndCard={onDragEnd}
          onDragOverStage={onDragOverStage}
          onDropStage={onDropStage}
        />
      )}

      {!loading && activePipeline && view === 'list' && (
        <ListBoard
          leads={leads}
          stages={activePipeline.stages}
          onRowClick={(l) => setSelectedLead(l)}
          onQuickStageChange={(id, stageId) => updateLead(id, { stageId })}
        />
      )}

      {/* Lead detail drawer */}
      {selectedLead && (
        <LeadDrawer
          lead={selectedLead}
          pipelines={pipelines}
          stages={
            pipelines.find((p) => p.id === selectedLead.pipeline_id)?.stages
            ?? activePipeline?.stages
            ?? []
          }
          onClose={() => setSelectedLead(null)}
          onUpdate={(patch) => updateLead(selectedLead.id, patch)}
          onDelete={() => deleteLead(selectedLead.id)}
          onConvert={() => convertToCustomer(selectedLead)}
          onRefresh={loadLeads}
        />
      )}

      {/* Pipeline editor */}
      {editorOpen && (
        <PipelineEditor
          pipelines={pipelines}
          activeId={activePipelineId}
          onClose={() => setEditorOpen(false)}
          onChanged={(next) => { setPipelines(next); }}
          onActivePipelineChange={setActivePipelineId}
        />
      )}

      {/* Add-lead modal */}
      {addingOpen && activePipelineId && (
        <AddLeadModal
          key={activePipelineId}
          pipelines={pipelines}
          defaultPipelineId={activePipelineId}
          onClose={() => setAddingOpen(false)}
          onSave={createLead}
        />
      )}
    </div>
  );
}

// ─── Pipeline: compact control in header + friendly tabs when multiple ───────

function PipelineControls({
  pipelines, activeId, onChange, onManage,
}: {
  pipelines: Pipeline[];
  activeId: string | null;
  onChange: (id: string) => void;
  onManage: () => void;
}) {
  const active = pipelines.find((p) => p.id === activeId) ?? pipelines[0];
  if (pipelines.length <= 1) {
    return (
      <div className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2">
        <span className="text-xs font-medium text-gray-800 max-w-[200px] truncate">
          {active?.name ?? 'Pipeline'}
        </span>
        <button
          type="button"
          onClick={onManage}
          title="Edit pipelines"
          className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
        >
          <Settings2 className="w-3.5 h-3.5" /> Edit
        </button>
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-2">
      <div className="relative">
        <select
          value={activeId ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none rounded-2xl border border-gray-200 bg-white pl-3 pr-9 py-2 text-xs font-medium text-gray-800 focus:outline-none min-w-[140px]"
          aria-label="Switch pipeline"
        >
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.is_default ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
      </div>
      <button
        type="button"
        onClick={onManage}
        title="Edit pipelines"
        className="inline-flex items-center gap-1 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        <Settings2 className="w-3.5 h-3.5" /> Edit
      </button>
    </div>
  );
}

function PipelineTabs({
  pipelines, activeId, onChange,
}: {
  pipelines: Pipeline[];
  activeId: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div
      className="flex flex-wrap gap-2 rounded-2xl border border-gray-200 bg-gray-50/80 p-1.5"
      role="tablist"
      aria-label="Sales pipelines"
    >
      {pipelines.map((p) => {
        const active = p.id === activeId;
        return (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p.id)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/60 border border-transparent'
            }`}
          >
            <span className="truncate max-w-[200px]">{p.name}</span>
            {p.is_default && (
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Default
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Kanban board ────────────────────────────────────────────────────────────

function KanbanBoard({
  pipeline, leadsByStage, totalValueByStage,
  dragLeadId, dragOverStage,
  onCardClick, onDragStartCard, onDragEndCard, onDragOverStage, onDropStage,
}: {
  pipeline: Pipeline;
  leadsByStage: Map<string, Lead[]>;
  totalValueByStage: Map<string, number>;
  dragLeadId: string | null;
  dragOverStage: string | null;
  onCardClick: (l: Lead) => void;
  onDragStartCard: (e: React.DragEvent, id: string) => void;
  onDragEndCard: () => void;
  onDragOverStage: (e: React.DragEvent, stageId: string) => void;
  onDropStage: (e: React.DragEvent, stageId: string) => void;
}) {
  return (
    <div
      className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ msOverflowStyle: 'none' } as CSSProperties}
    >
      <div className="flex gap-3 min-w-max">
        {pipeline.stages.map((stage) => {
          const list = leadsByStage.get(stage.id) ?? [];
          const total = totalValueByStage.get(stage.id) ?? 0;
          const isOver = dragOverStage === stage.id;
          return (
            <div
              key={stage.id}
              onDragOver={(e) => onDragOverStage(e, stage.id)}
              onDrop={(e) => onDropStage(e, stage.id)}
              className={`w-[300px] shrink-0 rounded-2xl border ${
                isOver ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-gray-50/60'
              } p-2 transition-colors`}
            >
              <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: stage.color }} />
                  <h3 className="font-medium text-sm text-gray-800 truncate">{stage.name}</h3>
                  <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-white border border-gray-200 px-1.5 py-0.5 text-gray-500">
                    {list.length}
                  </span>
                </div>
                {total > 0 && (
                  <span className="text-[11px] font-medium text-gray-500 tabular-nums">
                    {formatMoney(total)}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2 pt-1">
                {list.length === 0 ? (
                  <div className="text-[11px] text-gray-400 italic py-6 px-2 text-center">
                    Drop a lead here
                  </div>
                ) : (
                  list.map((lead) => (
                    <KanbanCard
                      key={lead.id}
                      lead={lead}
                      bookingBadge={lead.booking_badge ?? null}
                      isDragging={dragLeadId === lead.id}
                      onClick={() => onCardClick(lead)}
                      onDragStart={(e) => onDragStartCard(e, lead.id)}
                      onDragEnd={onDragEndCard}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KanbanCard({
  lead, bookingBadge, isDragging, onClick, onDragStart, onDragEnd,
}: {
  lead: Lead;
  bookingBadge: { iso: string; variant: 'wedding' | 'appointment' } | null;
  isDragging: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group rounded-xl border bg-white p-3 shadow-sm cursor-pointer hover:border-gray-300 transition-all ${
        isDragging ? 'opacity-50 border-gray-400' : 'border-gray-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm text-gray-900 truncate">{displayName(lead)}</p>
          {lead.venue_name && (
            <p className="text-xs text-gray-500 truncate mt-0.5">{lead.venue_name}</p>
          )}
        </div>
        <GripVertical className="w-3.5 h-3.5 text-gray-300 opacity-0 group-hover:opacity-100 shrink-0" />
      </div>

      <div className="mt-2 space-y-1 text-xs text-gray-500">
        {lead.email && (
          <div className="flex items-center gap-1.5 truncate">
            <Mail className="w-3 h-3 shrink-0" /> <span className="truncate">{lead.email}</span>
          </div>
        )}
        {lead.phone && (
          <div className="flex items-center gap-1.5 truncate">
            <Phone className="w-3 h-3 shrink-0" /> {lead.phone}
          </div>
        )}
        {lead.wedding_date && (
          <div className="flex items-center gap-1.5">
            <CalendarIcon className="w-3 h-3 shrink-0" /> {formatDate(lead.wedding_date)}
          </div>
        )}
      </div>

      {bookingBadge && (
        <div className="mt-2 flex justify-end">
          <div
            className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-900 shadow-sm"
            title={bookingBadge.variant === 'wedding' ? 'Wedding booked' : 'Upcoming appointment'}
          >
            <CalendarPlus className="w-3.5 h-3.5 shrink-0 text-sky-700" />
            <span className="tabular-nums">{formatBookingPillText(bookingBadge.iso, bookingBadge.variant)}</span>
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <Clock className="w-3 h-3" /> {formatDate(lead.created_at)}
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          {lead.note_count > 0 && (
            <span className="inline-flex items-center gap-1 text-gray-500">
              <MessageSquare className="w-3 h-3" /> {lead.note_count}
            </span>
          )}
          {lead.opportunity_value != null && (
            <span className="inline-flex items-center gap-1 font-semibold text-gray-800 tabular-nums">
              {formatMoney(lead.opportunity_value)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── List view ───────────────────────────────────────────────────────────────

function ListBoard({
  leads, stages, onRowClick, onQuickStageChange,
}: {
  leads: Lead[];
  stages: Stage[];
  onRowClick: (l: Lead) => void;
  onQuickStageChange: (id: string, stageId: string) => void;
}) {
  if (leads.length === 0) {
    return (
      <div className="rounded-3xl border border-gray-200 bg-white flex flex-col items-center justify-center py-16 text-center text-gray-400">
        <Inbox className="w-10 h-10 mb-3" />
        <p className="text-sm">No leads match your filter yet.</p>
      </div>
    );
  }

  const stageById = new Map(stages.map((s) => [s.id, s]));

  return (
    <div className="rounded-3xl border border-gray-200 bg-white overflow-hidden">
      <ul className="divide-y divide-gray-100">
        {leads.map((lead) => {
          const stage = lead.stage_id ? stageById.get(lead.stage_id) : null;
          return (
            <li key={lead.id}>
              <div
                onClick={() => onRowClick(lead)}
                className="flex items-start gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{displayName(lead)}</span>
                    {stage && (
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5"
                        style={{
                          backgroundColor: `${stage.color}22`,
                          borderColor: `${stage.color}44`,
                          color: stage.color,
                        }}
                      >
                        {stage.name}
                      </span>
                    )}
                    {lead.venue_name && (
                      <span className="text-xs text-gray-400 truncate">· {lead.venue_name}</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    {lead.email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> {lead.email}</span>}
                    {lead.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {lead.phone}</span>}
                    {lead.wedding_date && <span className="flex items-center gap-1"><CalendarIcon className="w-3.5 h-3.5" /> {formatDate(lead.wedding_date)}</span>}
                    {lead.guest_count != null && <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {lead.guest_count} guests</span>}
                    {lead.venue_website_url && (
                      <a
                        href={lead.venue_website_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-gray-500 hover:text-gray-900"
                      >
                        <Globe className="w-3.5 h-3.5" /> Website
                      </a>
                    )}
                  </div>
                  {lead.message && (
                    <p className="mt-1 text-xs text-gray-500 line-clamp-1">{lead.message}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
                  {lead.booking_badge && (
                    <div className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-900">
                      <CalendarPlus className="w-3 h-3 shrink-0" />
                      {formatBookingPillText(lead.booking_badge.iso, lead.booking_badge.variant)}
                    </div>
                  )}
                  {lead.opportunity_value != null && (
                    <span className="text-sm font-semibold text-gray-800 tabular-nums">
                      {formatMoney(lead.opportunity_value)}
                    </span>
                  )}
                  <div className="text-[11px] text-gray-400 whitespace-nowrap pt-1">
                    {formatDate(lead.created_at)}
                  </div>
                  {stages.length > 0 && (
                    <select
                      value={lead.stage_id ?? ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onQuickStageChange(lead.id, e.target.value)}
                      className="rounded-xl border border-gray-200 bg-white px-2 py-1 text-xs focus:border-gray-400 focus:outline-none"
                    >
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Lead detail drawer ──────────────────────────────────────────────────────

function LeadDrawer({
  lead, pipelines, stages, onClose, onUpdate, onDelete, onConvert, onRefresh,
}: {
  lead: Lead;
  pipelines: Pipeline[];
  stages: Stage[];
  onClose: () => void;
  onUpdate: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onConvert: () => void;
  onRefresh: () => void;
}) {
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);

  const loadNotes = useCallback(async () => {
    setLoadingNotes(true);
    const res = await fetch(`/api/leads/${lead.id}/notes`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setNotes(data.notes ?? []);
    }
    setLoadingNotes(false);
  }, [lead.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadNotes(); }, [loadNotes]);

  async function addNote() {
    const content = newNote.trim();
    if (!content) return;
    const res = await fetch(`/api/leads/${lead.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      const data = await res.json();
      setNotes((prev) => [data.note, ...prev]);
      setNewNote('');
      onRefresh();
    }
  }

  async function saveNoteEdit() {
    if (!editingId) return;
    const res = await fetch(`/api/leads/${lead.id}/notes/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editingContent }),
    });
    if (res.ok) {
      const data = await res.json();
      setNotes((prev) => prev.map((n) => (n.id === editingId ? data.note : n)));
      setEditingId(null);
      setEditingContent('');
    }
  }

  async function deleteNote(noteId: string) {
    if (!confirm('Delete this note?')) return;
    const res = await fetch(`/api/leads/${lead.id}/notes/${noteId}`, { method: 'DELETE' });
    if (res.ok) {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      onRefresh();
    }
  }

  // Small inline-saving helper so each field shows a brief "saved" state.
  async function saveField(key: string, value: unknown) {
    setSavingField(key);
    onUpdate({ [key]: value });
    setTimeout(() => setSavingField(null), 400);
  }

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 bottom-0 w-full sm:w-[560px] bg-white shadow-2xl overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="font-heading text-xl text-gray-900 truncate">{displayName(lead)}</h2>
            <p className="text-xs text-gray-400">Added {formatDate(lead.created_at)} · {lead.source}</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 p-6 space-y-6">
          {/* Pipeline (multiple venues / processes) */}
          {pipelines.length > 0 && (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                Pipeline
              </label>
              <select
                value={lead.pipeline_id ?? pipelines[0]?.id ?? ''}
                onChange={(e) => {
                  const pid = e.target.value;
                  if (!pid) return;
                  const p = pipelines.find((x) => x.id === pid);
                  const first = p?.stages?.[0];
                  if (first) onUpdate({ pipelineId: pid, stageId: first.id });
                }}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 focus:border-gray-400 focus:outline-none"
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-gray-400">
                Leads stay in one pipeline at a time. Changing pipeline moves this card and sets its stage to the first column of the new pipeline — adjust stage below if needed.
              </p>
            </div>
          )}

          {/* Stage picker */}
          {stages.length > 0 && (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Stage</label>
              <div className="flex flex-wrap gap-1.5">
                {stages.map((s) => {
                  const active = s.id === lead.stage_id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => saveField('stageId', s.id)}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
                      style={
                        active
                          ? { backgroundColor: s.color, borderColor: s.color, color: readableOn(s.color) }
                          : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#374151' }
                      }
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Contact */}
          <section className="grid grid-cols-2 gap-3">
            <Field label="First name" value={lead.first_name ?? ''}
              onSave={(v) => saveField('firstName', v)} saving={savingField === 'firstName'} />
            <Field label="Last name" value={lead.last_name ?? ''}
              onSave={(v) => saveField('lastName', v)} saving={savingField === 'lastName'} />
            <Field label="Email" value={lead.email} type="email" className="col-span-2"
              onSave={(v) => saveField('email', v)} saving={savingField === 'email'} />
            <Field label="Phone" value={lead.phone ?? ''} type="tel"
              onSave={(v) => saveField('phone', v)} saving={savingField === 'phone'} />
            <Field label="Opportunity value" value={lead.opportunity_value?.toString() ?? ''} type="number" prefix="$"
              onSave={(v) => saveField('opportunityValue', v === '' ? null : Number(v))} saving={savingField === 'opportunityValue'} />
          </section>

          {/* Venue */}
          <section className="grid grid-cols-2 gap-3">
            <Field label="Venue name" value={lead.venue_name ?? ''} className="col-span-2"
              onSave={(v) => saveField('venueName', v)} saving={savingField === 'venueName'} />
            <Field label="Venue website" value={lead.venue_website_url ?? ''} type="url" className="col-span-2"
              onSave={(v) => saveField('venueWebsiteUrl', v)} saving={savingField === 'venueWebsiteUrl'} />
            <Field label="Wedding date" value={lead.wedding_date ?? ''} type="date"
              onSave={(v) => saveField('weddingDate', v || null)} saving={savingField === 'weddingDate'} />
            <Field label="Guest count" value={lead.guest_count?.toString() ?? ''} type="number"
              onSave={(v) => saveField('guestCount', v === '' ? null : Number(v))} saving={savingField === 'guestCount'} />
          </section>

          {/* Inquiry message */}
          {lead.message && (
            <section>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Inquiry message</label>
              <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-800 whitespace-pre-wrap">
                {lead.message}
              </div>
            </section>
          )}

          {/* Actions */}
          <section className="flex flex-wrap gap-2">
            <button
              onClick={() => setAppointmentOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <CalendarPlus className="w-3.5 h-3.5" /> Schedule appointment
            </button>
            <a
              href={`mailto:${lead.email}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Mail className="w-3.5 h-3.5" /> Reply
            </a>
            {lead.phone && (
              <a
                href={`tel:${lead.phone}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <Phone className="w-3.5 h-3.5" /> Call
              </a>
            )}
            {lead.listing_slug && (
              <a
                href={`${DIRECTORY_URL}/venue/${lead.listing_slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Listing
              </a>
            )}
            <button
              onClick={onConvert}
              className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
            >
              <UserPlus className="w-3.5 h-3.5" /> Create customer
            </button>
            <button
              onClick={onDelete}
              className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </section>

          {/* Notes */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4" /> Notes
              </h3>
              <span className="text-[11px] text-gray-400">{notes.length} total</span>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-3">
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Add a note… (timestamped)"
                rows={2}
                className="w-full rounded-xl border border-gray-200 p-2 text-sm focus:border-gray-400 focus:outline-none resize-none"
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={addNote}
                  disabled={!newNote.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  style={{ backgroundColor: '#1b1b1b' }}
                >
                  <Plus className="w-3.5 h-3.5" /> Add note
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {loadingNotes ? (
                <div className="text-xs text-gray-400 py-3 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading notes…
                </div>
              ) : notes.length === 0 ? (
                <p className="text-xs text-gray-400 italic py-2">No notes yet.</p>
              ) : (
                notes.map((n) => (
                  <div key={n.id} className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatDateTime(n.created_at)}
                        {n.author_name === 'system' && (
                          <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">system</span>
                        )}
                      </span>
                      {n.author_name !== 'system' && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { setEditingId(n.id); setEditingContent(n.content); }}
                            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => deleteNote(n.id)}
                            className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                    {editingId === n.id ? (
                      <>
                        <textarea
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          rows={2}
                          className="w-full rounded-xl border border-gray-200 p-2 text-sm focus:border-gray-400 focus:outline-none resize-none"
                        />
                        <div className="flex justify-end gap-2 mt-2">
                          <button
                            onClick={() => { setEditingId(null); setEditingContent(''); }}
                            className="rounded-xl border border-gray-200 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                          >Cancel</button>
                          <button
                            onClick={saveNoteEdit}
                            className="rounded-xl px-2.5 py-1 text-xs font-medium text-white"
                            style={{ backgroundColor: '#1b1b1b' }}
                          >Save</button>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">{n.content}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {appointmentOpen && (
          <AppointmentModal
            leadId={lead.id}
            onClose={() => setAppointmentOpen(false)}
            onScheduled={() => {
              setAppointmentOpen(false);
              loadNotes();
              onRefresh();
            }}
          />
        )}
      </aside>
    </div>
  );
}

// Inline-edit field helper used in the drawer. Auto-saves on blur / Enter.
function Field({
  label, value, onSave, saving, type = 'text', prefix, className,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  saving?: boolean;
  type?: string;
  prefix?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  return (
    <div className={className}>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
        {label}{saving && <span className="ml-2 text-green-600 normal-case text-[10px]">saved</span>}
      </label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">{prefix}</span>
        )}
        <input
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft !== value) onSave(draft); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && type !== 'textarea') {
              (e.target as HTMLInputElement).blur();
            }
          }}
          className={`w-full rounded-xl border border-gray-200 ${prefix ? 'pl-6' : 'pl-3'} pr-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none`}
        />
      </div>
    </div>
  );
}

// ─── Appointment modal ───────────────────────────────────────────────────────

function AppointmentModal({
  leadId, onClose, onScheduled,
}: {
  leadId: string;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [eventType, setEventType] = useState('tour');
  const [spaceId, setSpaceId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/spaces', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setSpaces(Array.isArray(data) ? data : []));
  }, []);

  async function schedule() {
    setError(null);
    setSaving(true);
    try {
      const start = new Date(`${date}T${startTime}:00`);
      const end   = new Date(`${date}T${endTime}:00`);
      if (end <= start) {
        setError('End time must be after start time.');
        return;
      }

      const res = await fetch(`/api/leads/${leadId}/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: eventType,
          start_at:   start.toISOString(),
          end_at:     end.toISOString(),
          space_id:   spaceId || null,
          notes:      notes || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error === 'conflict' ? data.message : (data.error || 'Failed to schedule'));
        return;
      }
      onScheduled();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative w-full max-w-md rounded-3xl border border-gray-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h3 className="font-heading text-lg text-gray-900 flex items-center gap-2">
              <CalendarPlus className="w-4.5 h-4.5" /> Schedule appointment
            </h3>
            <button onClick={onClose} className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-6 space-y-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Event type</label>
              <select
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
              >
                <option value="tour">Tour</option>
                <option value="meeting">Meeting</option>
                <option value="tasting">Tasting</option>
                <option value="rehearsal">Rehearsal</option>
                <option value="wedding">Wedding</option>
                <option value="reception">Reception</option>
                <option value="hold">Hold</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Start</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">End</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
                />
              </div>
            </div>
            {spaces.length > 0 && (
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Space (optional)</label>
                <select
                  value={spaceId}
                  onChange={(e) => setSpaceId(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
                >
                  <option value="">No specific space</option>
                  {spaces.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Notes (optional)</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none resize-none"
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
            <button
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >Cancel</button>
            <button
              onClick={schedule}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: '#1b1b1b' }}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarPlus className="w-3.5 h-3.5" />}
              Add to calendar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pipeline editor modal ───────────────────────────────────────────────────

function PipelineEditor({
  pipelines, activeId, onClose, onChanged, onActivePipelineChange,
}: {
  pipelines: Pipeline[];
  activeId: string | null;
  onClose: () => void;
  onChanged: (next: Pipeline[]) => void;
  onActivePipelineChange: (id: string) => void;
}) {
  const [editingPipelineId, setEditingPipelineId] = useState<string | null>(activeId);
  const [newPipelineName, setNewPipelineName] = useState('');
  const [newStageName, setNewStageName] = useState('');
  const [busy, setBusy] = useState(false);

  const editing = pipelines.find((p) => p.id === editingPipelineId) ?? pipelines[0];

  async function apply(res: Response) {
    if (res.ok) {
      const data = await res.json();
      onChanged(data.pipelines ?? []);
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Something went wrong');
    }
  }

  async function createPipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setBusy(true);
    const res = await fetch('/api/pipelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, useDefaultStages: true }),
    });
    await apply(res);
    setNewPipelineName('');
    setBusy(false);
  }

  async function renamePipeline(id: string, name: string) {
    const res = await fetch(`/api/pipelines/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await apply(res);
  }

  async function deletePipeline(id: string) {
    if (!confirm('Delete this pipeline? Leads in it will be kept but unassigned.')) return;
    const res = await fetch(`/api/pipelines/${id}`, { method: 'DELETE' });
    await apply(res);
  }

  async function makeDefault(id: string) {
    const res = await fetch(`/api/pipelines/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_default: true }),
    });
    await apply(res);
  }

  async function addStage() {
    if (!editing) return;
    const name = newStageName.trim();
    if (!name) return;
    const res = await fetch(`/api/pipelines/${editing.id}/stages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await apply(res);
    setNewStageName('');
  }

  async function renameStage(stageId: string, name: string) {
    if (!editing) return;
    const res = await fetch(`/api/pipelines/${editing.id}/stages/${stageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await apply(res);
  }

  async function changeStageColor(stageId: string, color: string) {
    if (!editing) return;
    const res = await fetch(`/api/pipelines/${editing.id}/stages/${stageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color }),
    });
    await apply(res);
  }

  async function changeStageKind(stageId: string, kind: string) {
    if (!editing) return;
    const res = await fetch(`/api/pipelines/${editing.id}/stages/${stageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    });
    await apply(res);
  }

  async function deleteStage(stageId: string) {
    if (!editing) return;
    if (!confirm('Delete this stage? Any cards in it will become unassigned.')) return;
    const res = await fetch(`/api/pipelines/${editing.id}/stages/${stageId}`, {
      method: 'DELETE',
    });
    await apply(res);
  }

  async function moveStage(stageId: string, direction: -1 | 1) {
    if (!editing) return;
    const current = editing.stages.findIndex((s) => s.id === stageId);
    if (current < 0) return;
    const next = current + direction;
    if (next < 0 || next >= editing.stages.length) return;
    const order = editing.stages.map((s) => s.id);
    [order[current], order[next]] = [order[next], order[current]];
    const res = await fetch(`/api/pipelines/${editing.id}/stages`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    });
    await apply(res);
  }

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative w-full max-w-3xl max-h-[90vh] rounded-3xl border border-gray-200 bg-white shadow-2xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h3 className="font-heading text-lg text-gray-900">Edit pipelines</h3>
            <button onClick={onClose} className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid sm:grid-cols-[260px_1fr] flex-1 min-h-0">
            {/* Left: pipeline list */}
            <aside className="border-r border-gray-100 p-4 overflow-y-auto">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Pipelines</h4>
              <ul className="space-y-1">
                {pipelines.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => setEditingPipelineId(p.id)}
                      className={`w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors ${
                        editingPipelineId === p.id
                          ? 'border-gray-900 bg-gray-50 text-gray-900'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span className="truncate">{p.name}</span>
                      {p.is_default && (
                        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">default</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-4 space-y-2">
                <input
                  value={newPipelineName}
                  onChange={(e) => setNewPipelineName(e.target.value)}
                  placeholder="New pipeline name"
                  className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
                />
                <button
                  onClick={createPipeline}
                  disabled={busy || !newPipelineName.trim()}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: '#1b1b1b' }}
                >
                  <Plus className="w-3.5 h-3.5" /> Add pipeline
                </button>
              </div>
            </aside>

            {/* Right: stages */}
            <div className="p-4 overflow-y-auto min-h-0">
              {editing ? (
                <>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex-1 min-w-0">
                      <Field
                        label="Pipeline name"
                        value={editing.name}
                        onSave={(v) => renamePipeline(editing.id, v)}
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-4">
                      {!editing.is_default && (
                        <button
                          onClick={() => makeDefault(editing.id)}
                          className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Make default
                        </button>
                      )}
                      <button
                        onClick={() => {
                          onActivePipelineChange(editing.id);
                          onClose();
                        }}
                        className="rounded-xl px-3 py-1.5 text-xs font-medium text-white"
                        style={{ backgroundColor: '#1b1b1b' }}
                      >
                        Use this pipeline
                      </button>
                      {!editing.is_default && (
                        <button
                          onClick={() => deletePipeline(editing.id)}
                          className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                    Stages ({editing.stages.length})
                  </h4>

                  <ul className="space-y-2">
                    {editing.stages.map((s, i) => (
                      <StageRow
                        key={s.id}
                        stage={s}
                        canMoveUp={i > 0}
                        canMoveDown={i < editing.stages.length - 1}
                        onRename={(name) => renameStage(s.id, name)}
                        onChangeColor={(color) => changeStageColor(s.id, color)}
                        onChangeKind={(kind) => changeStageKind(s.id, kind)}
                        onDelete={() => deleteStage(s.id)}
                        onMoveUp={() => moveStage(s.id, -1)}
                        onMoveDown={() => moveStage(s.id, 1)}
                      />
                    ))}
                  </ul>

                  <div className="mt-3 flex gap-2">
                    <input
                      value={newStageName}
                      onChange={(e) => setNewStageName(e.target.value)}
                      placeholder="New stage name"
                      className="flex-1 rounded-xl border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
                    />
                    <button
                      onClick={addStage}
                      disabled={!newStageName.trim()}
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      style={{ backgroundColor: '#1b1b1b' }}
                    >
                      <Plus className="w-3.5 h-3.5" /> Add stage
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-500">No pipeline selected.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StageRow({
  stage, canMoveUp, canMoveDown, onRename, onChangeColor, onChangeKind,
  onDelete, onMoveUp, onMoveDown,
}: {
  stage: Stage;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: (name: string) => void;
  onChangeColor: (color: string) => void;
  onChangeKind: (kind: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [name, setName] = useState(stage.name);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setName(stage.name); }, [stage.name]);

  return (
    <li className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-2">
      <input
        type="color"
        value={stage.color}
        onChange={(e) => onChangeColor(e.target.value)}
        className="w-7 h-7 rounded cursor-pointer border border-gray-200"
        title="Stage color"
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (name.trim() && name !== stage.name) onRename(name.trim()); }}
        className="flex-1 rounded-lg border border-transparent hover:border-gray-200 focus:border-gray-400 px-2 py-1 text-sm focus:outline-none"
      />
      <select
        value={stage.kind}
        onChange={(e) => onChangeKind(e.target.value)}
        className="rounded-lg border border-gray-200 px-2 py-1 text-xs focus:border-gray-400 focus:outline-none"
      >
        <option value="open">Active</option>
        <option value="won">Won</option>
        <option value="lost">Lost</option>
      </select>
      <div className="flex items-center">
        <button
          onClick={onMoveUp}
          disabled={!canMoveUp}
          className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
          title="Move up"
        >
          <ArrowLeft className="w-3.5 h-3.5 rotate-90" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={!canMoveDown}
          className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
          title="Move down"
        >
          <ArrowRight className="w-3.5 h-3.5 rotate-90" />
        </button>
      </div>
      <button
        onClick={onDelete}
        className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"
        title="Delete stage"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </li>
  );
}

// ─── Add-lead modal ──────────────────────────────────────────────────────────

function AddLeadModal({
  pipelines, defaultPipelineId, onClose, onSave,
}: {
  pipelines: Pipeline[];
  defaultPipelineId: string;
  onClose: () => void;
  onSave: (draft: LeadDraft) => void;
}) {
  const initialPipeline = pipelines.find((p) => p.id === defaultPipelineId) ?? pipelines[0];
  const [draft, setDraft] = useState<LeadDraft>(() => {
    const d = emptyDraft(initialPipeline?.id ?? defaultPipelineId);
    const first = initialPipeline?.stages?.[0];
    return { ...d, stageId: first?.id ?? '' };
  });
  const [saving, setSaving] = useState(false);

  const stagesForPipeline = useMemo(() => {
    const p = pipelines.find((x) => x.id === draft.pipelineId);
    return p?.stages ?? [];
  }, [pipelines, draft.pipelineId]);

  async function submit() {
    if (!draft.firstName.trim() && !draft.lastName.trim()) {
      alert('Please provide at least a first or last name');
      return;
    }
    if (!draft.email.trim()) {
      alert('Email is required');
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative w-full max-w-2xl max-h-[90vh] rounded-3xl border border-gray-200 bg-white shadow-2xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h3 className="font-heading text-lg text-gray-900 flex items-center gap-2">
              <UserPlus className="w-4.5 h-4.5" /> New lead
            </h3>
            <button onClick={onClose} className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-6 overflow-y-auto space-y-3">
            {pipelines.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Pipeline</label>
                  <select
                    value={draft.pipelineId}
                    onChange={(e) => {
                      const pid = e.target.value;
                      const p = pipelines.find((x) => x.id === pid);
                      const first = p?.stages?.[0];
                      setDraft((prev) => ({
                        ...prev,
                        pipelineId: pid,
                        stageId: first?.id ?? '',
                      }));
                    }}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                  >
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.is_default ? ' (default)' : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Stage</label>
                  <select
                    value={draft.stageId}
                    onChange={(e) => set('stageId', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                  >
                    {stagesForPipeline.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <DraftField label="First name" value={draft.firstName} onChange={(v) => set('firstName', v)} />
              <DraftField label="Last name" value={draft.lastName} onChange={(v) => set('lastName', v)} />
            </div>
            <DraftField label="Email" value={draft.email} type="email" onChange={(v) => set('email', v)} />
            <DraftField label="Phone" value={draft.phone} type="tel" onChange={(v) => set('phone', v)} />
            <div className="grid grid-cols-2 gap-3">
              <DraftField label="Venue name" value={draft.venueName} onChange={(v) => set('venueName', v)} />
              <DraftField label="Venue website" value={draft.venueWebsiteUrl} type="url" onChange={(v) => set('venueWebsiteUrl', v)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DraftField label="Opportunity value" prefix={<DollarSign className="w-3.5 h-3.5 text-gray-400" />} value={draft.opportunityValue} type="number" onChange={(v) => set('opportunityValue', v)} />
              <DraftField label="Wedding date" value={draft.weddingDate} type="date" onChange={(v) => set('weddingDate', v)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DraftField label="Guest count" value={draft.guestCount} type="number" onChange={(v) => set('guestCount', v)} />
              <DraftField label="Booking timeline" value={draft.bookingTimeline} onChange={(v) => set('bookingTimeline', v)} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Message / inquiry</label>
              <textarea
                rows={3}
                value={draft.message}
                onChange={(e) => set('message', e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none resize-none"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
            <button
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >Cancel</button>
            <button
              onClick={submit}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: '#1b1b1b' }}
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create lead
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DraftField({
  label, value, onChange, type = 'text', prefix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  prefix?: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2">{prefix}</span>}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-xl border border-gray-200 ${prefix ? 'pl-7' : 'pl-3'} pr-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none`}
        />
      </div>
    </div>
  );
}
