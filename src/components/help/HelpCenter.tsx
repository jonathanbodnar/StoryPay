'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  // UI
  Search, X, Mic, MicOff, ChevronRight, ChevronDown, Loader2, HelpCircle,
  ThumbsUp, ThumbsDown, Sparkles, BookOpen,
  // Category icons — a superset covering both article sets. Articles store icon
  // names as strings so the data modules stay free of React imports.
  Zap, LayoutDashboard, Users, BarChart2, CreditCard, FileText, Receipt,
  Calendar, RefreshCw, Palette, Mail, UsersRound, Bell, BellRing, Link2,
  Settings, DollarSign, Package, Store, Inbox, Heart, MessageCircle,
  UserCircle, LifeBuoy, Braces, Send, Armchair, Globe, ListChecks, User,
} from 'lucide-react';
import { normaliseHelpQuery } from '@/lib/help-search';
import {
  enrichArticles,
  getBestSnippet,
  getRelatedArticles,
  matchesSubstring,
  sortHelpCategoriesForDisplay,
  escapeForRegExp,
  type EnrichedArticle,
  type HelpArticleShape,
  type HelpCategoryShape,
} from '@/lib/help-ui';

/**
 * The Help Center, shared by the venue dashboard and the couple app.
 *
 * One component rather than two copies so the two audiences cannot drift apart
 * in look, feel, or search behaviour. Only the article set, the search
 * endpoint, and whether an AI panel exists differ between them.
 */

const ICON_MAP: Record<string, React.ElementType> = {
  Zap, LayoutDashboard, Users, BarChart2, CreditCard, FileText, Receipt,
  Calendar, RefreshCw, Palette, Mail, UsersRound, Bell, BellRing, Link2,
  Settings, DollarSign, Package, Store, Inbox, Heart, MessageCircle,
  UserCircle, LifeBuoy, Braces, Send, Armchair, Globe, ListChecks, User,
};

const DEFAULT_BRAND = '#1b1b1b';

export interface HelpCenterProps {
  categories: HelpCategoryShape[];
  /** Category pinned first in every listing (the "Getting Started" equivalent). */
  firstCategoryId: string;
  title?: string;
  subtitle?: string;
  /** Dark brand surface. Matches the venue dashboard by default. */
  brand?: string;
  /**
   * Semantic search endpoint. Omit and the Help Center still works, using
   * keyword matching only, with no network calls.
   */
  searchEndpoint?: string;
  /** Search analytics endpoint. Omitted for audiences we do not log. */
  logSearchEndpoint?: string;
  /** Ratings endpoint. Omit to hide the "was this helpful" footer. */
  rateEndpoint?: string;
  /**
   * When provided, an "Ask AI" toggle and panel are offered. Deliberately
   * optional: the couple Help Center is search-only.
   */
  aiPanel?: React.ReactNode;
  /** Shown where the AI calls-to-action would sit when there is no AI panel. */
  fallbackCta?: React.ReactNode;
  /** Path used when stripping ?article / ?reset from the URL. */
  basePath: string;
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
}

// ─── Small presentational helpers ────────────────────────────────────────────

/** Wraps every case-insensitive match of `term` in a yellow mark. */
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term || term.length < 2) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeForRegExp(term)})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 font-medium not-italic text-yellow-900">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** Renders an article body: blank line = spacer, "- " = bullet, "1. " = step. */
function ArticleBody({ text, highlight = '' }: { text: string; highlight?: string }) {
  const term = normaliseHelpQuery(highlight);
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-gray-700">
      {text.split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        if (line.trimStart().startsWith('- ')) {
          return (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
              <span>
                <Highlight text={line.replace(/^[-\s]+/, '')} term={term} />
              </span>
            </div>
          );
        }
        if (/^\d+\.\s/.test(line.trimStart())) {
          return (
            <p key={i} className="pl-1 font-medium text-gray-800">
              <Highlight text={line} term={term} />
            </p>
          );
        }
        return (
          <p key={i}>
            <Highlight text={line} term={term} />
          </p>
        );
      })}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function HelpCenter({
  categories,
  firstCategoryId,
  title = 'Help Center',
  subtitle = 'Documentation, guides, and platform reference.',
  brand = DEFAULT_BRAND,
  searchEndpoint,
  logSearchEndpoint,
  rateEndpoint,
  aiPanel,
  fallbackCta,
  basePath,
  searchPlaceholder = 'Search or ask anything\u2026 e.g. \u201chow do I add a guest\u201d',
}: HelpCenterProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const cats = useMemo(
    () =>
      sortHelpCategoriesForDisplay(categories, firstCategoryId).map((c) => ({
        ...c,
        icon: ICON_MAP[c.iconName] ?? HelpCircle,
      })),
    [categories, firstCategoryId],
  );
  const allArticles = useMemo(() => enrichArticles(categories), [categories]);

  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [activeArticle, setActiveArticle] = useState<HelpArticleShape | null>(null);
  const [articleHighlight, setArticleHighlight] = useState('');
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [showAI, setShowAI] = useState(false);
  const normalisedQuery = useMemo(() => normaliseHelpQuery(query), [query]);

  const hasAI = Boolean(aiPanel);

  // ── Reset to home (sidebar "Help Center" link points at ?reset=1) ──────────
  useEffect(() => {
    if (searchParams.get('reset') === '1') {
      setQuery('');
      setActiveCat(null);
      setActiveArticle(null);
      setExpandedCats(new Set());
      setShowAI(false);
      router.replace(basePath, { scroll: false });
    }
  }, [searchParams, router, basePath]);

  // ── Voice search ──────────────────────────────────────────────────────────
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const searchRecRef = useRef<any>(null);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    setSpeechSupported(!!(w['SpeechRecognition'] || w['webkitSpeechRecognition']));
  }, []);

  function toggleSearchVoice() {
    const w = window as unknown as Record<string, unknown>;
    const SR = (w['SpeechRecognition'] || w['webkitSpeechRecognition']) as
      | (new () => {
          continuous: boolean;
          interimResults: boolean;
          lang: string;
          start(): void;
          stop(): void;
          onresult: ((e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void) | null;
          onend: (() => void) | null;
          onerror: (() => void) | null;
        })
      | undefined;
    if (!SR) return;
    if (isListening) {
      searchRecRef.current?.stop();
      setIsListening(false);
      return;
    }
    const r = new SR();
    r.continuous = false;
    r.interimResults = false;
    r.lang = 'en-US';
    r.onresult = (e) => {
      setQuery(e.results[0][0].transcript);
      setActiveCat(null);
      setActiveArticle(null);
    };
    r.onend = () => setIsListening(false);
    r.onerror = () => setIsListening(false);
    searchRecRef.current = r;
    r.start();
    setIsListening(true);
  }

  // ── Semantic search (debounced); silently degrades to keyword matching ────
  const [semanticIds, setSemanticIds] = useState<string[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!searchEndpoint || !normalisedQuery || normalisedQuery.length < 3) {
      setSemanticIds([]);
      setSemanticLoading(false);
      return;
    }
    setSemanticLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(searchEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: normalisedQuery }),
        });
        if (!res.ok) {
          setSemanticLoading(false);
          return;
        }
        const data = await res.json();
        const ids = ((data.results ?? []) as { article_id: string }[]).map((r) => r.article_id);
        setSemanticIds(ids);
      } catch {
        /* non-fatal: keyword results still render */
      } finally {
        setSemanticLoading(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [normalisedQuery, searchEndpoint]);

  // ── Deep link: <basePath>?article=<id> opens that article directly ────────
  useEffect(() => {
    const id = searchParams.get('article');
    if (id) {
      const a = allArticles.find((x) => x.id === id);
      if (a) {
        setActiveArticle(a);
        setArticleHighlight('');
        router.replace(basePath);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyword results (fast, synchronous — works with no API key at all)
  const substringResults = useMemo(() => {
    if (!normalisedQuery || normalisedQuery.length < 2) return new Set<string>();
    return new Set(allArticles.filter((a) => matchesSubstring(a, normalisedQuery)).map((a) => a.id));
  }, [normalisedQuery, allArticles]);

  // Merge: semantic order first, then any keyword-only hits. `semanticOnly`
  // marks a hit the keywords missed, which is what earns the "related" pill.
  const searchResults = useMemo(() => {
    if (!normalisedQuery || normalisedQuery.length < 2) return [];
    const seen = new Set<string>();
    const merged: { article: EnrichedArticle; semanticOnly: boolean }[] = [];

    for (const id of semanticIds) {
      const a = allArticles.find((x) => x.id === id);
      if (a && !seen.has(id)) {
        seen.add(id);
        merged.push({ article: a, semanticOnly: !substringResults.has(id) });
      }
    }
    for (const id of substringResults) {
      if (!seen.has(id)) {
        const a = allArticles.find((x) => x.id === id);
        if (a) {
          seen.add(id);
          merged.push({ article: a, semanticOnly: false });
        }
      }
    }
    return merged;
  }, [semanticIds, substringResults, normalisedQuery, allArticles]);

  const isSearching = normalisedQuery.length >= 2;
  const showLoading = isSearching && semanticLoading && searchResults.length === 0;

  // Log searches once the results settle, not mid-keystroke.
  const logSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (logSearchRef.current) clearTimeout(logSearchRef.current);
    if (!logSearchEndpoint) return;
    if (!normalisedQuery || normalisedQuery.length < 2 || semanticLoading) return;
    logSearchRef.current = setTimeout(() => {
      fetch(logSearchEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search_term: normalisedQuery, result_count: searchResults.length }),
      }).catch(() => {
        /* non-critical */
      });
    }, 1500);
    return () => {
      if (logSearchRef.current) clearTimeout(logSearchRef.current);
    };
  }, [normalisedQuery, semanticLoading, searchResults.length, logSearchEndpoint]);

  const activeCategory = activeCat ? cats.find((c) => c.id === activeCat) : null;

  // ── Ratings ──────────────────────────────────────────────────────────────
  const [ratings, setRatings] = useState<Record<string, 'up' | 'down'>>({});
  const [ratingBusy, setRatingBusy] = useState<string | null>(null);

  async function rateArticle(articleId: string, rating: 'up' | 'down') {
    if (!rateEndpoint || ratings[articleId] || ratingBusy === articleId) return;
    setRatingBusy(articleId);
    try {
      await fetch(rateEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article_id: articleId, rating }),
      });
      setRatings((prev) => ({ ...prev, [articleId]: rating }));
    } catch {
      /* non-critical */
    } finally {
      setRatingBusy(null);
    }
  }

  function selectArticle(article: HelpArticleShape) {
    setActiveArticle(article);
    setArticleHighlight(normalisedQuery);
    setShowAI(false);
  }

  function toggleCat(id: string) {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      {/* ── Header ── */}
      <div className="mb-8">
        <div className="mb-1 flex items-center gap-3">
          <BookOpen size={22} className="text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        </div>
        <p className="ml-9 text-sm text-gray-500">{subtitle}</p>
      </div>

      {/* ── Search + optional AI toggle ── */}
      <div className="mb-8 flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveCat(null);
              setActiveArticle(null);
            }}
            className={`w-full rounded-2xl border bg-white py-3 pl-10 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100 ${
              isListening ? 'border-red-300 ring-2 ring-red-100' : 'border-gray-200'
            } ${query || speechSupported ? 'pr-16' : 'pr-4'}`}
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            {query && (
              <button onClick={() => setQuery('')} className="p-1 text-gray-400 hover:text-gray-600" aria-label="Clear search">
                <X size={15} />
              </button>
            )}
            {speechSupported && (
              <button
                type="button"
                onClick={toggleSearchVoice}
                title={isListening ? 'Stop recording' : 'Search by voice'}
                className={`rounded-lg p-1 transition-colors ${
                  isListening ? 'bg-red-50 text-red-500' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                }`}
              >
                {isListening ? <MicOff size={15} /> : <Mic size={15} />}
              </button>
            )}
          </div>
        </div>

        {hasAI && (
          <button
            onClick={() => {
              setShowAI((v) => !v);
              setActiveArticle(null);
              setActiveCat(null);
              setQuery('');
            }}
            className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition-all ${
              showAI ? 'text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
            }`}
            style={showAI ? { backgroundColor: brand, borderColor: brand } : undefined}
          >
            <Sparkles size={15} />
            Ask AI
          </button>
        )}
      </div>

      <div className="flex items-start gap-6">
        {/* ── Sidebar: categories (desktop) ── */}
        <aside className="hidden w-60 flex-shrink-0 space-y-3 lg:block">
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="border-b border-gray-200 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Topics</p>
            </div>
            <nav className="space-y-0.5 p-2">
              {cats.map((cat) => {
                const Icon = cat.icon;
                const isActive = activeCat === cat.id && !isSearching;
                return (
                  <button
                    key={cat.id}
                    onClick={() => {
                      setActiveCat(cat.id);
                      setActiveArticle(null);
                      setQuery('');
                      setShowAI(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      isActive ? 'text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                    style={isActive ? { backgroundColor: brand } : undefined}
                  >
                    <Icon size={14} />
                    <span className="flex-1">{cat.label}</span>
                    <span className={`text-xs ${isActive ? 'text-white/50' : 'text-gray-400'}`}>
                      {cat.articles.length}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="min-w-0 flex-1">
          {/* AI panel */}
          {showAI && (
            <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white" style={{ height: 520 }}>
              <div className="flex items-center gap-2.5 border-b border-gray-200 px-4 py-3.5" style={{ backgroundColor: brand }}>
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                  <Sparkles size={14} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold leading-none text-white">Ask AI</p>
                  <p className="mt-0.5 text-[11px] text-white/50">Powered by your live account data</p>
                </div>
              </div>
              <div className="flex h-[calc(520px-57px)] flex-col">{aiPanel}</div>
            </div>
          )}

          {/* Search results */}
          {isSearching && !showAI && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-gray-500">
                    {showLoading ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 size={13} className="animate-spin text-gray-400" /> Searching&hellip;
                      </span>
                    ) : searchResults.length === 0 ? (
                      <>
                        No articles found for <span className="font-medium text-gray-700">&ldquo;{query}&rdquo;</span>
                      </>
                    ) : (
                      <>
                        {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for{' '}
                        <span className="font-medium text-gray-700">&ldquo;{normalisedQuery}&rdquo;</span>
                      </>
                    )}
                  </p>
                  {!semanticLoading && semanticIds.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                      <Sparkles size={9} /> AI-powered
                    </span>
                  )}
                </div>
                {normalisedQuery !== query.trim().toLowerCase() && query.trim() && (
                  <p className="hidden text-xs italic text-gray-400 sm:block">Searching: &ldquo;{normalisedQuery}&rdquo;</p>
                )}
              </div>

              {showLoading && (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="animate-pulse rounded-2xl border border-gray-200 bg-white p-4">
                      <div className="flex gap-3">
                        <div className="h-7 w-7 flex-shrink-0 rounded-lg bg-gray-100" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3.5 w-2/3 rounded bg-gray-100" />
                          <div className="h-2.5 w-1/4 rounded bg-gray-50" />
                          <div className="h-2.5 w-full rounded bg-gray-50" />
                          <div className="h-2.5 w-3/4 rounded bg-gray-50" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!showLoading && searchResults.length === 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
                  <HelpCircle size={32} className="mx-auto mb-3 text-gray-300" />
                  <p className="mb-1 text-sm text-gray-500">No articles match your search.</p>
                  <p className="mb-5 text-xs text-gray-400">
                    {hasAI ? 'Try different words, or ask AI directly.' : 'Try different words, or browse the topics.'}
                  </p>
                  {hasAI ? (
                    <button
                      onClick={() => {
                        setShowAI(true);
                        setQuery('');
                      }}
                      className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
                      style={{ backgroundColor: brand }}
                    >
                      <Sparkles size={14} /> Ask AI instead
                    </button>
                  ) : (
                    <button
                      onClick={() => setQuery('')}
                      className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
                      style={{ backgroundColor: brand }}
                    >
                      Browse topics
                    </button>
                  )}
                </div>
              )}

              {!showLoading && searchResults.length > 0 && (
                <div className="space-y-3">
                  {searchResults.map(({ article: a, semanticOnly }) => {
                    const cat = cats.find((c) => c.id === a.catId);
                    const Icon = cat ? cat.icon : HelpCircle;
                    const snippet = semanticOnly
                      ? a.body.split('\n').find((l) => l.trim()) || ''
                      : getBestSnippet(a.body, normalisedQuery);
                    return (
                      <button
                        key={a.id}
                        onClick={() => {
                          selectArticle(a);
                          setQuery('');
                        }}
                        className="w-full rounded-2xl border border-gray-200 bg-white p-4 text-left transition-all hover:border-gray-300"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                            style={{ backgroundColor: (cat?.color ?? '#9ca3af') + '18' }}
                          >
                            <Icon size={14} style={{ color: cat?.color ?? '#9ca3af' }} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="mb-0.5 flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-gray-900">
                                {semanticOnly ? a.title : <Highlight text={a.title} term={normalisedQuery} />}
                              </p>
                              {semanticOnly && (
                                <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-600">
                                  <Sparkles size={8} /> related
                                </span>
                              )}
                            </div>
                            <p className="mb-1.5 text-xs text-gray-400">{a.catLabel}</p>
                            <p className="text-xs leading-relaxed text-gray-500">
                              {semanticOnly ? snippet : <Highlight text={snippet} term={normalisedQuery} />}
                            </p>
                          </div>
                          <ChevronRight size={14} className="mt-1 flex-shrink-0 text-gray-300" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Category + article browsing */}
          {!isSearching && !showAI && (
            <>
              {activeArticle ? (
                <div className="rounded-2xl border border-gray-200 bg-white">
                  <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
                    <button
                      onClick={() => setActiveArticle(null)}
                      className="flex items-center gap-1 text-xs text-gray-400 transition-colors hover:text-gray-700"
                    >
                      ← Back
                    </button>
                    {activeCategory && (
                      <>
                        <span className="text-xs text-gray-300">/</span>
                        <span className="text-xs text-gray-400">{activeCategory.label}</span>
                      </>
                    )}
                  </div>
                  <div className="p-6 sm:p-8">
                    <h2 className="mb-5 text-xl font-bold text-gray-900">
                      <Highlight text={activeArticle.title} term={articleHighlight} />
                    </h2>
                    <ArticleBody text={activeArticle.body} highlight={articleHighlight} />

                    {(() => {
                      const related = getRelatedArticles(allArticles, activeArticle.id);
                      if (related.length === 0) return null;
                      return (
                        <div className="mt-8 border-t border-gray-200 pt-6">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Related articles</p>
                          <div className="space-y-1.5">
                            {related.map((a) => (
                              <button
                                key={a.id}
                                onClick={() => {
                                  setActiveArticle(a);
                                  setArticleHighlight('');
                                }}
                                className="group flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition-colors hover:bg-gray-100"
                              >
                                <div className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: a.catColor }} />
                                <span className="flex-1 truncate text-sm font-medium text-gray-700 group-hover:text-gray-900">
                                  {a.title}
                                </span>
                                <span className="flex-shrink-0 text-xs text-gray-400">{a.catLabel}</span>
                                <ChevronRight size={13} className="flex-shrink-0 text-gray-300" />
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    <div className="mt-8 space-y-4 border-t border-gray-200 pt-6">
                      {rateEndpoint && (
                        <div className="flex items-center gap-3">
                          <p className="flex-shrink-0 text-xs text-gray-400">Was this helpful?</p>
                          {ratings[activeArticle.id] ? (
                            <span className="text-xs text-gray-500">
                              {ratings[activeArticle.id] === 'up'
                                ? 'Thanks for the feedback!'
                                : "Thanks, we'll improve this."}
                            </span>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => rateArticle(activeArticle.id, 'up')}
                                disabled={ratingBusy === activeArticle.id}
                                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-40"
                              >
                                <ThumbsUp size={12} /> Yes
                              </button>
                              <button
                                onClick={() => rateArticle(activeArticle.id, 'down')}
                                disabled={ratingBusy === activeArticle.id}
                                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                              >
                                <ThumbsDown size={12} /> No
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {hasAI ? (
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-400">Not what you were looking for?</p>
                          <button
                            onClick={() => setShowAI(true)}
                            className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
                            style={{ backgroundColor: brand }}
                          >
                            <Sparkles size={12} /> Ask AI
                          </button>
                        </div>
                      ) : (
                        fallbackCta
                      )}
                    </div>
                  </div>
                </div>
              ) : activeCategory ? (
                <div>
                  <div className="mb-4 flex items-start gap-3">
                    <div
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
                      style={{ backgroundColor: activeCategory.color + '18' }}
                    >
                      <activeCategory.icon size={18} style={{ color: activeCategory.color }} />
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <h2 className="text-lg font-bold text-gray-900">{activeCategory.label}</h2>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {activeCategory.articles.length} article{activeCategory.articles.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {activeCategory.articles.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => selectArticle(a)}
                        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 text-left transition-all hover:border-gray-300"
                      >
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{a.title}</p>
                          <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{a.body.split('\n')[0]}</p>
                        </div>
                        <ChevronRight size={15} className="flex-shrink-0 text-gray-300" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  {/* Mobile: expandable categories */}
                  <div className="mb-6 space-y-2 lg:hidden">
                    {cats.map((cat) => {
                      const Icon = cat.icon;
                      const open = expandedCats.has(cat.id);
                      return (
                        <div key={cat.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                          <button
                            onClick={() => toggleCat(cat.id)}
                            className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left"
                          >
                            <div className="flex min-w-0 flex-1 items-start gap-3">
                              <div
                                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                                style={{ backgroundColor: cat.color + '18' }}
                              >
                                <Icon size={15} style={{ color: cat.color }} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold leading-tight text-gray-900">{cat.label}</p>
                                <p className="mt-1 text-xs leading-tight tabular-nums text-gray-400">
                                  {cat.articles.length} article{cat.articles.length !== 1 ? 's' : ''}
                                </p>
                              </div>
                            </div>
                            <ChevronDown
                              size={14}
                              className={`mt-1 flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
                            />
                          </button>
                          {open && (
                            <div className="divide-y divide-gray-50 border-t border-gray-200">
                              {cat.articles.map((a) => (
                                <button
                                  key={a.id}
                                  onClick={() => selectArticle(a)}
                                  className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-gray-50"
                                >
                                  <span className="text-sm text-gray-700">{a.title}</span>
                                  <ChevronRight size={13} className="flex-shrink-0 text-gray-300" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop: category cards */}
                  <div className="hidden auto-rows-fr gap-4 lg:grid lg:grid-cols-2 xl:grid-cols-3">
                    {cats.map((cat) => {
                      const Icon = cat.icon;
                      return (
                        <button
                          key={cat.id}
                          onClick={() => {
                            setActiveCat(cat.id);
                            setActiveArticle(null);
                          }}
                          className="group flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 text-left transition-all hover:border-gray-300"
                        >
                          <div className="mb-3 flex items-start gap-3">
                            <div
                              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
                              style={{ backgroundColor: cat.color + '18' }}
                            >
                              <Icon size={18} style={{ color: cat.color }} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold leading-tight text-gray-900 group-hover:text-gray-700">
                                {cat.label}
                              </p>
                              <p className="mt-1 text-xs leading-tight text-gray-400">
                                {cat.articles.length} article{cat.articles.length !== 1 ? 's' : ''}
                              </p>
                            </div>
                          </div>
                          <div className="flex-1 space-y-1.5">
                            {cat.articles.slice(0, 3).map((a) => (
                              <p key={a.id} className="flex items-start gap-1.5 text-xs text-gray-500">
                                <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-gray-300" />
                                <span className="leading-snug">{a.title}</span>
                              </p>
                            ))}
                            {cat.articles.length > 3 && (
                              <p className="pl-2.5 text-xs text-gray-400">+{cat.articles.length - 3} more</p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
