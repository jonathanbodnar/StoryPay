'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, RefreshCw, LayoutGrid, List as ListIcon, ExternalLink,
  StickyNote, Sparkles, CheckCircle2, Clock, ShieldCheck, FileText,
  MessageSquare, X, Image as ImageIcon,
} from 'lucide-react';
import { AdStudioModal } from '@/components/admin/AdStudioModal';

const DIRECTORY_URL = process.env.NEXT_PUBLIC_DIRECTORY_URL ?? 'https://storyvenue.com';

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
  project_notes: string | null;
  created_at: string;
  pricing_guide_ready: boolean;
  ad_creatives_count: number;
}

// ── Status helpers ───────────────────────────────────────────────────────────

function a2pState(c: Card): { label: string; tone: 'ok' | 'warn' | 'idle' } {
  if (c.a2p_verified) return { label: 'A2P verified', tone: 'ok' };
  const s = (c.a2p_campaign_status || c.a2p_brand_status || '').toLowerCase();
  if (s.includes('approv') || s.includes('verif') || s.includes('active')) {
    return { label: 'A2P approved', tone: 'ok' };
  }
  if (s.includes('pend') || s.includes('review') || s.includes('progress')) {
    return { label: 'A2P pending', tone: 'warn' };
  }
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

// ── Component ────────────────────────────────────────────────────────────────

export function AdminProjectsBoard() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'board' | 'list'>('board');

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const [notesCard, setNotesCard] = useState<Card | null>(null);
  const [adVenue, setAdVenue] = useState<Card | null>(null);

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

  // Effective stage: unstaged cards land in the first column.
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

  // ── Drag & drop ────────────────────────────────────────────────────────────

  const persistMove = useCallback(async (venueId: string, stageId: string, orderedIds: string[]) => {
    try {
      const res = await fetch('/api/admin/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, stageId, orderedIds }),
      });
      if (!res.ok) throw new Error('move failed');
    } catch {
      load(); // reconcile with server on failure
    }
  }, [load]);

  const moveCard = useCallback((venueId: string, destStageId: string, beforeId: string | null) => {
    setCards((prev) => {
      const moving = prev.find((c) => c.id === venueId);
      if (!moving) return prev;
      // Destination column ids in current order, excluding the moving card.
      const destIds = prev
        .filter((c) => effStage(c) === destStageId && c.id !== venueId)
        .sort((a, b) => (a.project_position ?? 0) - (b.project_position ?? 0) || a.created_at.localeCompare(b.created_at))
        .map((c) => c.id);
      const insertAt = beforeId ? destIds.indexOf(beforeId) : destIds.length;
      const ordered = [...destIds];
      ordered.splice(insertAt < 0 ? destIds.length : insertAt, 0, venueId);

      const posOf = new Map(ordered.map((id, i) => [id, i]));
      const next = prev.map((c) =>
        posOf.has(c.id)
          ? { ...c, project_stage_id: destStageId, project_position: posOf.get(c.id)! }
          : c,
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

  // ── Notes ──────────────────────────────────────────────────────────────────

  const saveNotes = useCallback(async (venueId: string, notes: string) => {
    setCards((prev) => prev.map((c) => (c.id === venueId ? { ...c, project_notes: notes } : c)));
    try {
      await fetch('/api/admin/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, notes }),
      });
    } catch { /* best-effort */ }
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
        {/^Projects schema/.test(error) && (
          <p className="mt-2 text-xs text-red-600">
            Open <code className="font-mono">/api/admin/run-migration-207</code> once to create the tables.
          </p>
        )}
        <button
          onClick={load}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
        >
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
            {cards.length} private client{cards.length === 1 ? '' : 's'} · drag cards to track onboarding, A2P & ads
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
            <button
              onClick={() => setView('board')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${view === 'board' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Board
            </button>
            <button
              onClick={() => setView('list')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${view === 'list' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}
            >
              <ListIcon className="h-3.5 w-3.5" /> List
            </button>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
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
                      onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/venue-id', c.id); }}
                      onDragEnd={() => { setDragId(null); setDragOverStage(null); }}
                      onDropBefore={(e) => onCardDrop(e, stage.id, c.id)}
                      dragging={dragId === c.id}
                      onNotes={() => setNotesCard(c)}
                      onAds={() => setAdVenue(c)}
                    />
                  ))}
                  {list.length === 0 && (
                    <div className="text-center text-[11px] text-gray-400 py-8">Drop clients here</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <ListView
          stages={stages}
          cardsByStage={cardsByStage}
          onNotes={setNotesCard}
          onAds={setAdVenue}
        />
      )}

      {notesCard && (
        <NotesModal
          card={notesCard}
          onClose={() => setNotesCard(null)}
          onSave={(notes) => { saveNotes(notesCard.id, notes); setNotesCard(null); }}
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
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

function ProjectCard({
  card, onDragStart, onDragEnd, onDropBefore, dragging, onNotes, onAds,
}: {
  card: Card;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDropBefore: (e: React.DragEvent) => void;
  dragging: boolean;
  onNotes: () => void;
  onAds: () => void;
}) {
  const a2p = a2pState(card);
  const loc = [card.city, card.state].filter(Boolean).join(', ');
  const listingUrl = card.slug ? `${DIRECTORY_URL}/venue/${card.slug}` : null;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={onDropBefore}
      className={`group rounded-lg border border-gray-200 bg-white p-3 shadow-sm cursor-grab active:cursor-grabbing transition ${dragging ? 'opacity-40' : 'hover:shadow-md'}`}
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

      <div className="mt-2.5 flex flex-wrap gap-1">
        <Chip tone={card.onboarding_completed || card.setup_completed ? 'ok' : 'warn'} icon={card.onboarding_completed || card.setup_completed ? CheckCircle2 : Clock}>
          {card.onboarding_completed || card.setup_completed ? 'Onboarded' : (card.onboarding_status || 'Onboarding')}
        </Chip>
        <Chip tone={card.pricing_guide_ready ? 'ok' : 'idle'} icon={FileText}>
          {card.pricing_guide_ready ? 'Guide live' : 'No guide'}
        </Chip>
        <Chip tone={a2p.tone} icon={ShieldCheck}>{a2p.label}</Chip>
        {(card.venue_concierge || card.ai_concierge_enabled) && (
          <Chip tone="ok" icon={MessageSquare}>Concierge</Chip>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between border-t border-gray-100 pt-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onNotes}
            title="Notes"
            className={`inline-flex items-center gap-1 text-[11px] font-medium ${card.project_notes ? 'text-amber-600' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <StickyNote className="h-3.5 w-3.5" />
            {card.project_notes ? 'Notes' : 'Add note'}
          </button>
          {listingUrl && (
            <a
              href={listingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-gray-600"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Listing
            </a>
          )}
        </div>
        <button
          onClick={onAds}
          className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-gray-700"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Ads{card.ad_creatives_count > 0 ? ` · ${card.ad_creatives_count}` : ''}
        </button>
      </div>
    </div>
  );
}

// ── List view ────────────────────────────────────────────────────────────────

function ListView({
  stages, cardsByStage, onNotes, onAds,
}: {
  stages: Stage[];
  cardsByStage: Map<string, Card[]>;
  onNotes: (c: Card) => void;
  onAds: (c: Card) => void;
}) {
  return (
    <div className="space-y-6">
      {stages.map((stage) => {
        const list = cardsByStage.get(stage.id) ?? [];
        if (list.length === 0) return null;
        return (
          <div key={stage.id}>
            <div className="flex items-center gap-2 mb-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
              <h3 className="text-sm font-semibold text-gray-800">{stage.label}</h3>
              <span className="text-xs text-gray-400">({list.length})</span>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100">
              {list.map((c) => {
                const a2p = a2pState(c);
                const loc = [c.city, c.state].filter(Boolean).join(', ');
                return (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-3">
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
                    <div className="hidden md:flex items-center gap-1.5">
                      <Chip tone={c.pricing_guide_ready ? 'ok' : 'idle'} icon={FileText}>{c.pricing_guide_ready ? 'Guide' : 'No guide'}</Chip>
                      <Chip tone={a2p.tone} icon={ShieldCheck}>{a2p.label}</Chip>
                    </div>
                    <button onClick={() => onNotes(c)} title="Notes" className={`p-1.5 rounded-md ${c.project_notes ? 'text-amber-600' : 'text-gray-400 hover:text-gray-600'}`}>
                      <StickyNote className="h-4 w-4" />
                    </button>
                    <button onClick={() => onAds(c)} className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-gray-700">
                      <Sparkles className="h-3.5 w-3.5" /> Ads
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Notes modal ──────────────────────────────────────────────────────────────

function NotesModal({
  card, onClose, onSave,
}: {
  card: Card;
  onClose: () => void;
  onSave: (notes: string) => void;
}) {
  const [text, setText] = useState(card.project_notes ?? '');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Notes</h3>
            <p className="text-xs text-gray-400">{card.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            autoFocus
            placeholder="Track to-dos, blockers, A2P status, ad ideas…"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 resize-none"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-800">Cancel</button>
          <button onClick={() => onSave(text)} className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-gray-700">Save</button>
        </div>
      </div>
    </div>
  );
}
