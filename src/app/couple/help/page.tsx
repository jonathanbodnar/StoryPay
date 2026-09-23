'use client';

import { useMemo, useState } from 'react';
import {
  Search,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Heart,
  Users,
  Armchair,
  ListChecks,
  Globe,
  MessageCircle,
  User,
  X,
} from 'lucide-react';
import {
  COUPLE_HELP_CATEGORIES,
  type CoupleHelpArticle,
  type CoupleHelpCategory,
} from '@/lib/couple-help-articles';

/**
 * Help & how-to for the couple ("bride") side of StoryVenue.
 *
 * Deliberately self-contained: couple help is a separate article set from the
 * venue Help Center, and search runs locally over the imported articles so this
 * page touches nothing that the venue help search index depends on.
 */

const ICON_MAP: Record<string, React.ElementType> = {
  Heart,
  Users,
  Armchair,
  ListChecks,
  Globe,
  MessageCircle,
  User,
};

interface Category extends CoupleHelpCategory {
  icon: React.ElementType;
}

const CATEGORIES: Category[] = COUPLE_HELP_CATEGORIES.map((c) => ({
  ...c,
  icon: ICON_MAP[c.iconName] ?? HelpCircle,
}));

const TOTAL_ARTICLES = CATEGORIES.reduce((n, c) => n + c.articles.length, 0);

function matches(article: CoupleHelpArticle, query: string): boolean {
  if (!query) return true;
  const haystack = `${article.title} ${article.tags.join(' ')} ${article.body}`.toLowerCase();
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

export default function CoupleHelpPage() {
  const [raw, setRaw] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Strip common question prefixes so "how do I add a guest" finds "Adding guests".
  const query = useMemo(() => {
    let q = raw.trim().toLowerCase();
    q = q.replace(/^(how do i|how do you|how to|what is|what are|where is|where can i|can i|i want to|i need to|show me|help me|explain)\s+/, '');
    return q;
  }, [raw]);

  const filtered = useMemo(
    () =>
      CATEGORIES
        .map((c) => ({ ...c, articles: c.articles.filter((a) => matches(a, query)) }))
        .filter((c) => c.articles.length > 0),
    [query],
  );

  const resultCount = filtered.reduce((n, c) => n + c.articles.length, 0);
  const searching = query.length > 0;

  return (
    <div>
      <div>
        <h1 className="font-heading text-2xl text-gray-900">Help &amp; how-to</h1>
        <p className="mt-1 text-sm text-gray-500">
          {searching
            ? `${resultCount} ${resultCount === 1 ? 'article' : 'articles'} matching “${raw.trim()}”`
            : `How to use your Wedding Planner, step by step. ${TOTAL_ARTICLES} articles.`}
        </p>
      </div>

      {/* Search — instant, over titles, tags, and body text. */}
      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Search, e.g. “RSVP”, “seating”, “wedding website”"
          className="w-full rounded-2xl border border-gray-200 bg-white py-3 pl-10 pr-10 text-sm text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200"
          aria-label="Search help articles"
        />
        {raw && (
          <button
            type="button"
            onClick={() => setRaw('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <HelpCircle className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-600">
            Nothing matched “{raw.trim()}”.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Try a shorter phrase, or browse the categories below.
          </p>
          <button
            type="button"
            onClick={() => setRaw('')}
            className="mt-4 rounded-xl bg-[#1b1b1b] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {filtered.map((cat) => {
            const isCollapsed = !!collapsed[cat.id];
            return (
              <section key={cat.id}>
                <button
                  type="button"
                  onClick={() => setCollapsed((prev) => ({ ...prev, [cat.id]: !isCollapsed }))}
                  className="flex w-full items-center gap-2.5 text-left"
                  aria-expanded={!isCollapsed}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white"
                    style={{ backgroundColor: cat.color }}
                  >
                    <cat.icon className="h-4 w-4" />
                  </span>
                  <h2 className="font-heading text-lg text-gray-900">{cat.label}</h2>
                  <span className="text-xs text-gray-400">{cat.articles.length}</span>
                  <span className="ml-auto text-gray-400">
                    {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="mt-3 space-y-2">
                    {cat.articles.map((a) => {
                      const open = openId === a.id;
                      return (
                        <div key={a.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                          <button
                            type="button"
                            onClick={() => setOpenId(open ? null : a.id)}
                            aria-expanded={open}
                            className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50"
                          >
                            <span className="min-w-0 flex-1 text-sm font-semibold text-gray-900">{a.title}</span>
                            <span className="shrink-0 text-gray-300">
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </span>
                          </button>
                          {open && (
                            <div className="border-t border-gray-100 px-4 py-4">
                              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{a.body}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-10 text-center text-xs text-gray-400">
        Still stuck? Message your venue from the Messages tab, or contact StoryVenue support.
      </p>
    </div>
  );
}
