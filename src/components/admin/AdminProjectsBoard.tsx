'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, RefreshCw, LayoutGrid, List as ListIcon, StickyNote, Sparkles,
  CheckCircle2, Clock, ShieldCheck, FileText, MessageSquare, X, Image as ImageIcon,
  Eye, Plus, Search, Trash2, GripVertical,
} from 'lucide-react';
import { AdStudioModal } from '@/components/admin/AdStudioModal';

interface Stage {
  id: string;
  key: string;
  label: string;
  color: string;
  position: number;
}

interface Card {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  city: string | null;
  state: string | null;
  is_private_client: boolean | null;
  onboarding_status: string | null;
  onboarding_completed: boolean | null;
  setup_completed: boolean | null;
  a2p_brand_status: string | null;
  a2p_campaign_status: string | null;
  a2p_verified: boolean | null;
  venue_concierge: boolean | null;
  ai_concierge_enabled: boolean | null;
  project_stage_id: string | null;
  project_position: number | null;
  created_at: string;
  pricing_guide_ready: boolean;
  ad_creatives_count: number;
  notes_count: number;
}

interface Note {
  id: string;
  body: string;
  author: string | null;
  created_at: string;
}

// ── Status helpers ───────────────────────────────────────────────────────────

function a2pState(c: Card): { label: string; tone: 'ok' | 'warn' | 'idle' } {
  if (c.a2p_verified) return { label: 'A2P verified', tone: 'ok' };
  const s = (c.a2p_campaign_status || c.a2p_brand_status || '').toLowerCase();
  if (s.includes('approv') || s.includes('verif') || s.includes('active')) return { label: 'A2P approved', tone: 'ok' };
  if (s.includes('pend') || s.includes('review') || s.includes('progress')) return { label: 'A2P pending', tone: 'warn' };
  if (s.includes('reject') || s.includes('fail')) return { label: 'A2P failed', tone: 'warn' };
  return { label: 'A2P not started', tone: 'idle' };
}

function Chip({
  tone, icon: Icon, children,
}: {
  tone: 'ok' | 'warn' | 'idle';
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const cls =
    tone === 'ok'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : tone === 'warn'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-gray-50 text-gray-500 border-gray-200';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}

function StatusChips({ card }: { card: Card }) {
  const a2p = a2pState(card);
  return (
    <>
      <Chip tone={card.onboarding_completed || card.setup_completed ? 'ok' : 'warn'} icon={card.onboarding_completed || card.setup_completed ? CheckCircle2 : Clock}>
        {card.onboarding_completed || card.setup_completed ? 'Onboarded' : (card.onboarding_status || 'Onboarding')}
      </Chip>
      <Chip tone={card.pricing_guide_ready ? 'ok' : 'idle'} icon={FileText}>
        {card.pricing_guide_ready ? 'Guide live' : 'No guide'}
      </Chip>
      <Chip tone={a2p.tone} icon={ShieldCheck}>{a2p.label}</Chip>
      {(card.venue_concierge || card.ai_concierge_enabled) && <Chip tone="ok" icon={MessageSquare}>Concierge</Chip>}
    </>
  );
}

async function viewAsVenue(venueId: string) {
  const res = await fetch('/api/admin/impersonate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ venueId, returnUrl: '/admin/projects' }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    alert(j.error || 'Could not start venue preview');
    return;
  }
  window.location.href = '/dashboard';
}

// ── Component ────────────────────────────────────────────────────────────────

export function AdminProjectsBoard() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'board' | 'list'>('board');

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [adVenue, setAdVenue] = useState<Card | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/projects', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load projects');
      setStages(json.stages || []);
      setCards(json.cards || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const firstStageId = stages[0]?.id ?? null;
  const openCard = useMemo(() => cards.find((c) => c.id === openCardId) ?? null, [cards, openCardId]);

  const effStage = useCallback(
    (c: Card) => (c.project_stage_id && stages.some((s) => s.id === c.project_stage_id) ? c.project_stage_id : firstStageId),
    [stages, firstStageId],
  );

  const cardsByStage = useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const s of stages) map.set(s.id, []);
    for (const c of cards) {
      const sid = effStage(c);
      if (sid && map.has(sid)) map.get(sid)!.push(c);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.project_position ?? 0) - (b.project_position ?? 0) || a.created_at.localeCompare(b.created_at));
    }
    return map;
  }, [cards, stages, effStage]);

  // ── Drag & drop (shared by board + list) ─────────────────────────────────────

  const persistMove = useCallback(async (venueId: string, stageId: string, orderedIds: string[]) => {
    try {
      const res = await fetch('/api/admin/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, stageId, orderedIds }),
      });
      if (!res.ok) throw new Error('move failed');
    } catch {
      load();
    }
  }, [load]);

  const moveCard = useCallback((venueId: string, destStageId: string, beforeId: string | null) => {
    setCards((prev) => {
      const moving = prev.find((c) => c.id === venueId);
      if (!moving) return prev;
      const destIds = prev
        .filter((c) => effStage(c) === destStageId && c.id !== venueId)
        .sort((a, b) => (a.project_position ?? 0) - (b.project_position ?? 0) || a.created_at.localeCompare(b.created_at))
        .map((c) => c.id);
      const insertAt = beforeId ? destIds.indexOf(beforeId) : destIds.length;
      const ordered = [...destIds];
      ordered.splice(insertAt < 0 ? destIds.length : insertAt, 0, venueId);

      const posOf = new Map(ordered.map((id, i) => [id, i]));
      const next = prev.map((c) =>
        posOf.has(c.id) ? { ...c, project_stage_id: destStageId, project_position: posOf.get(c.id)! } : c,
      );
      void persistMove(venueId, destStageId, ordered);
      return next;
    });
  }, [effStage, persistMove]);

  const onCardDrop = (e: React.DragEvent, destStageId: string, beforeId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData('text/venue-id') || dragId;
    setDragId(null);
    setDragOverStage(null);
    if (id) moveCard(id, destStageId, beforeId);
  };

  const dragProps = (card: Card, stageId: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { setDragId(card.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/venue-id', card.id); },
    onDragEnd: () => { setDragId(null); setDragOverStage(null); },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); },
    onDrop: (e: React.DragEvent) => onCardDrop(e, stageId, card.id),
  });

  // ── Add / remove from board ──────────────────────────────────────────────────

  const addVenue = useCallback(async (venueId: string) => {
    if (!firstStageId) return;
    await fetch('/api/admin/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venueId, stageId: firstStageId, orderedIds: [venueId] }),
    }).catch(() => {});
    await load();
  }, [firstStageId, load]);

  const removeVenue = useCallback(async (venueId: string) => {
    setOpenCardId(null);
    await fetch('/api/admin/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venueId, action: 'remove' }),
    }).catch(() => {});
    await load();
  }, [load]);

  const changeStage = useCallback((venueId: string, stageId: string) => {
    moveCard(venueId, stageId, null);
  }, [moveCard]);

  const bumpNotesCount = useCallback((venueId: string) => {
    setCards((prev) => prev.map((c) => (c.id === venueId ? { ...c, notes_count: c.notes_count + 1 } : c)));
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading projects…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-700 font-medium">{error}</p>
        {/schema/i.test(error) && (
          <p className="mt-2 text-xs text-red-600">
            Open <code className="font-mono">/api/admin/run-migration-207</code> once to create the tables.
          </p>
        )}
        <button onClick={load} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-500">
            {cards.length} client{cards.length === 1 ? '' : 's'} · drag cards to track kickoff → A2P → training → live
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700"
          >
            <Plus className="h-3.5 w-3.5" /> Add venue
          </button>
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
            <button onClick={() => setView('board')} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${view === 'board' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}>
              <LayoutGrid className="h-3.5 w-3.5" /> Board
            </button>
            <button onClick={() => setView('list')} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${view === 'list' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}>
              <ListIcon className="h-3.5 w-3.5" /> List
            </button>
          </div>
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {view === 'board' ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => {
            const list = cardsByStage.get(stage.id) ?? [];
            const isOver = dragOverStage === stage.id;
            return (
              <div
                key={stage.id}
                onDragOver={(e) => { e.preventDefault(); if (dragOverStage !== stage.id) setDragOverStage(stage.id); }}
                onDrop={(e) => onCardDrop(e, stage.id, null)}
                className={`flex-shrink-0 w-[300px] rounded-xl border ${isOver ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-gray-50/60'} flex flex-col`}
              >
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                    <span className="text-sm font-semibold text-gray-800">{stage.label}</span>
                  </div>
                  <span className="text-xs font-medium text-gray-400">{list.length}</span>
                </div>
                <div className="flex-1 p-2 space-y-2 min-h-[120px]">
                  {list.map((c) => (
                    <ProjectCard
                      key={c.id}
                      card={c}
                      drag={dragProps(c, stage.id)}
                      dragging={dragId === c.id}
                      onOpen={() => setOpenCardId(c.id)}
                      onAds={() => setAdVenue(c)}
                    />
                  ))}
                  {list.length === 0 && <div className="text-center text-[11px] text-gray-400 py-8">Drop clients here</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <ListView
          stages={stages}
          cardsByStage={cardsByStage}
          dragProps={dragProps}
          dragOverStage={dragOverStage}
          setDragOverStage={setDragOverStage}
          onCardDrop={onCardDrop}
          onOpen={(c) => setOpenCardId(c.id)}
          onAds={setAdVenue}
        />
      )}

      {openCard && (
        <CardModal
          card={openCard}
          stages={stages}
          onClose={() => setOpenCardId(null)}
          onChangeStage={(stageId) => changeStage(openCard.id, stageId)}
          onViewAs={() => viewAsVenue(openCard.id)}
          onAds={() => { setAdVenue(openCard); }}
          onRemove={() => removeVenue(openCard.id)}
          onNoteAdded={() => bumpNotesCount(openCard.id)}
        />
      )}

      {adVenue && (
        <AdStudioModal
          venueId={adVenue.id}
          venueName={adVenue.name}
          onClose={() => setAdVenue(null)}
          onGenerated={() => load()}
        />
      )}

      {showAdd && (
        <AddVenueModal
          onClose={() => setShowAdd(false)}
          onAdd={async (id) => { await addVenue(id); }}
        />
      )}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

function ProjectCard({
  card, drag, dragging, onOpen, onAds,
}: {
  card: Card;
  drag: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean };
  dragging: boolean;
  onOpen: () => void;
  onAds: () => void;
}) {
  const loc = [card.city, card.state].filter(Boolean).join(', ');
  return (
    <div
      {...drag}
      onClick={onOpen}
      className={`group rounded-lg border border-gray-200 bg-white p-3 shadow-sm cursor-pointer transition ${dragging ? 'opacity-40' : 'hover:shadow-md hover:border-gray-300'}`}
    >
      <div className="flex items-start gap-2.5">
        {card.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.logo_url} alt="" className="h-9 w-9 rounded-md object-cover border border-gray-100 flex-shrink-0" />
        ) : (
          <div className="h-9 w-9 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0">
            <ImageIcon className="h-4 w-4 text-gray-300" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900 truncate">{card.name}</div>
          {loc && <div className="text-[11px] text-gray-400 truncate">{loc}</div>}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1"><StatusChips card={card} /></div>

      <div className="mt-2.5 flex items-center justify-between border-t border-gray-100 pt-2">
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${card.notes_count ? 'text-amber-600' : 'text-gray-400'}`}>
            <StickyNote className="h-3.5 w-3.5" />
            {card.notes_count ? `${card.notes_count} note${card.notes_count === 1 ? '' : 's'}` : 'Notes'}
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onAds(); }}
          className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-gray-700"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Ads{card.ad_creatives_count > 0 ? ` · ${card.ad_creatives_count}` : ''}
        </button>
      </div>
    </div>
  );
}

// ── List view (with drag & drop) ─────────────────────────────────────────────

function ListView({
  stages, cardsByStage, dragProps, dragOverStage, setDragOverStage, onCardDrop, onOpen, onAds,
}: {
  stages: Stage[];
  cardsByStage: Map<string, Card[]>;
  dragProps: (card: Card, stageId: string) => React.HTMLAttributes<HTMLDivElement> & { draggable: boolean };
  dragOverStage: string | null;
  setDragOverStage: (id: string | null) => void;
  onCardDrop: (e: React.DragEvent, destStageId: string, beforeId: string | null) => void;
  onOpen: (c: Card) => void;
  onAds: (c: Card) => void;
}) {
  return (
    <div className="space-y-5">
      {stages.map((stage) => {
        const list = cardsByStage.get(stage.id) ?? [];
        const isOver = dragOverStage === stage.id;
        return (
          <div
            key={stage.id}
            onDragOver={(e) => { e.preventDefault(); if (dragOverStage !== stage.id) setDragOverStage(stage.id); }}
            onDrop={(e) => onCardDrop(e, stage.id, null)}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
              <h3 className="text-sm font-semibold text-gray-800">{stage.label}</h3>
              <span className="text-xs text-gray-400">({list.length})</span>
            </div>
            <div className={`rounded-xl border ${isOver ? 'border-gray-900' : 'border-gray-200'} bg-white overflow-hidden divide-y divide-gray-100 min-h-[52px]`}>
              {list.map((c) => {
                const loc = [c.city, c.state].filter(Boolean).join(', ');
                return (
                  <div
                    key={c.id}
                    {...dragProps(c, stage.id)}
                    onClick={() => onOpen(c)}
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
                  >
                    <GripVertical className="h-4 w-4 text-gray-300 flex-shrink-0" />
                    {c.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.logo_url} alt="" className="h-8 w-8 rounded-md object-cover border border-gray-100" />
                    ) : (
                      <div className="h-8 w-8 rounded-md bg-gray-100 flex items-center justify-center">
                        <ImageIcon className="h-4 w-4 text-gray-300" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 truncate">{c.name}</div>
                      {loc && <div className="text-[11px] text-gray-400 truncate">{loc}</div>}
                    </div>
                    <div className="hidden md:flex items-center gap-1.5"><StatusChips card={c} /></div>
                    {c.notes_count > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600">
                        <StickyNote className="h-3.5 w-3.5" /> {c.notes_count}
                      </span>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); onAds(c); }} className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-gray-700">
                      <Sparkles className="h-3.5 w-3.5" /> Ads
                    </button>
                  </div>
                );
              })}
              {list.length === 0 && <div className="px-4 py-4 text-center text-[11px] text-gray-400">Drop clients here</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Card modal (near full-screen) ────────────────────────────────────────────

function CardModal({
  card, stages, onClose, onChangeStage, onViewAs, onAds, onRemove, onNoteAdded,
}: {
  card: Card;
  stages: Stage[];
  onClose: () => void;
  onChangeStage: (stageId: string) => void;
  onViewAs: () => void;
  onAds: () => void;
  onRemove: () => void;
  onNoteAdded: () => void;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const loc = [card.city, card.state].filter(Boolean).join(', ');
  const currentStageId = card.project_stage_id && stages.some((s) => s.id === card.project_stage_id)
    ? card.project_stage_id
    : stages[0]?.id ?? '';

  const loadNotes = useCallback(async () => {
    setLoadingNotes(true);
    try {
      const res = await fetch(`/api/admin/projects/notes?venueId=${encodeURIComponent(card.id)}`, { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setNotes(json.notes || []);
    } catch { /* ignore */ } finally {
      setLoadingNotes(false);
    }
  }, [card.id]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const addNote = useCallback(async () => {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/projects/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId: card.id, body }),
      });
      const json = await res.json();
      if (res.ok && json.note) {
        setNotes((prev) => [json.note, ...prev]);
        setDraft('');
        onNoteAdded();
      }
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }, [draft, card.id, onNoteAdded]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6" onClick={onClose}>
      <div
        className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            {card.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={card.logo_url} alt="" className="h-12 w-12 rounded-lg object-cover border border-gray-100" />
            ) : (
              <div className="h-12 w-12 rounded-lg bg-gray-100 flex items-center justify-center">
                <ImageIcon className="h-5 w-5 text-gray-300" />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 truncate">{card.name}</h2>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                {loc && <span>{loc}</span>}
                {card.is_private_client && <span className="rounded-full bg-pink-50 px-1.5 py-0.5 text-[10px] font-semibold text-pink-700">Private client</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50/60 px-6 py-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-500">Stage</span>
            <select
              value={currentStageId}
              onChange={(e) => onChangeStage(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-800 focus:border-gray-900 focus:outline-none"
            >
              {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="flex-1" />
          <button onClick={onViewAs} className="inline-flex items-center gap-1.5 rounded-lg border border-pink-200 bg-pink-50 px-3 py-1.5 text-xs font-semibold text-pink-900 hover:bg-pink-100">
            <Eye className="h-3.5 w-3.5" /> View as venue
          </button>
          <button onClick={onAds} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700">
            <Sparkles className="h-3.5 w-3.5" /> Generate ads
          </button>
          {!card.is_private_client && (
            <button onClick={onRemove} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200">
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          <div className="flex flex-wrap gap-1.5"><StatusChips card={card} /></div>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-800">Notes</h3>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') addNote(); }}
                rows={2}
                placeholder="Add a note (to-dos, blockers, A2P status, ad ideas)…  ⌘⏎ to save"
                className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
              <button
                onClick={addNote}
                disabled={saving || !draft.trim()}
                className="inline-flex h-fit items-center gap-1.5 self-end rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
              </button>
            </div>

            <div className="mt-4 space-y-2.5">
              {loadingNotes ? (
                <div className="flex items-center gap-2 py-6 text-xs text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading notes…</div>
              ) : notes.length === 0 ? (
                <p className="py-6 text-center text-xs text-gray-400">No notes yet. Add the first one above.</p>
              ) : (
                notes.map((n) => (
                  <div key={n.id} className="rounded-lg border border-gray-200 bg-white p-3">
                    <p className="whitespace-pre-wrap text-sm text-gray-800">{n.body}</p>
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-400">
                      <span className="font-medium text-gray-500">{n.author || 'Team'}</span>
                      <span>·</span>
                      <time>{new Date(n.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Add existing venue modal ─────────────────────────────────────────────────

interface SearchResult {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  city: string | null;
  state: string | null;
  is_private_client: boolean | null;
  project_stage_id: string | null;
  on_board: boolean;
}

function AddVenueModal({ onClose, onAdd }: { onClose: () => void; onAdd: (id: string) => Promise<void> }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/projects?q=${encodeURIComponent(term)}`, { cache: 'no-store' });
        const json = await res.json();
        if (res.ok) setResults(json.results || []);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  const handleAdd = async (r: SearchResult) => {
    setAddingId(r.id);
    await onAdd(r.id);
    setResults((prev) => prev.map((x) => (x.id === r.id ? { ...x, on_board: true } : x)));
    setAddingId(null);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-[10vh]" onClick={onClose}>
      <div className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-gray-900">Add a venue to the board</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
              placeholder="Search venues by name…"
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-xs text-gray-400 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</div>
          ) : q.trim().length < 2 ? (
            <p className="py-8 text-center text-xs text-gray-400">Type at least 2 characters to search.</p>
          ) : results.length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-400">No venues match “{q}”.</p>
          ) : (
            <div className="space-y-1.5">
              {results.map((r) => {
                const loc = [r.city, r.state].filter(Boolean).join(', ');
                return (
                  <div key={r.id} className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2">
                    {r.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.logo_url} alt="" className="h-8 w-8 rounded-md object-cover border border-gray-100" />
                    ) : (
                      <div className="h-8 w-8 rounded-md bg-gray-100 flex items-center justify-center"><ImageIcon className="h-4 w-4 text-gray-300" /></div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 truncate">{r.name}</div>
                      {loc && <div className="text-[11px] text-gray-400 truncate">{loc}</div>}
                    </div>
                    {r.on_board ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> On board</span>
                    ) : (
                      <button
                        onClick={() => handleAdd(r)}
                        disabled={addingId === r.id}
                        className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
                      >
                        {addingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
