'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { HelpCircle, X, ChevronRight, BookOpen, Sparkles } from 'lucide-react';
import { getArticlesForPath, getArticleById } from '@/lib/help-articles';

// Don't show the badge on the help page itself
const EXCLUDED_PATHS = ['/dashboard/help'];

export default function ContextualHelpBadge() {
  const pathname  = usePathname();
  const router    = useRouter();
  const [open, setOpen]       = useState(false);
  const [articleId, setArticleId] = useState<string | null>(null);
  const panelRef  = useRef<HTMLDivElement>(null);
  const btnRef    = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current   && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setArticleId(null);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close panel when navigating
  useEffect(() => {
    setOpen(false);
    setArticleId(null);
  }, [pathname]);

  if (EXCLUDED_PATHS.some(p => pathname.startsWith(p))) return null;

  const articleIds = getArticlesForPath(pathname);
  if (articleIds.length === 0) return null;

  const articles = articleIds
    .map(id => getArticleById(id))
    .filter(Boolean) as NonNullable<ReturnType<typeof getArticleById>>[];

  if (articles.length === 0) return null;

  const openArticle = articleId ? articles.find(a => a.id === articleId) : null;

  // Body preview: first non-empty line
  function preview(body: string) {
    return body.split('\n').find(l => l.trim()) || '';
  }

  function goToFullArticle(id: string) {
    setOpen(false);
    setArticleId(null);
    router.push(`/dashboard/help?article=${id}`);
  }

  return (
    <>
      {/* ── Floating badge button ── */}
      <button
        ref={btnRef}
        onClick={() => { setOpen(v => !v); setArticleId(null); }}
        aria-label="Contextual help"
        className={`
          fixed bottom-[5.5rem] right-4 sm:right-6 z-40
          flex h-10 w-10 items-center justify-center rounded-full
          border border-gray-200 bg-white shadow-lg
          text-gray-500 hover:text-gray-800 hover:shadow-xl
          transition-all duration-200 hover:scale-105 active:scale-95
          ${open ? 'ring-2 ring-gray-900 ring-offset-2 text-gray-900' : ''}
        `}
      >
        {open ? <X size={16} /> : <HelpCircle size={18} />}
      </button>

      {/* ── Popover panel ── */}
      {open && (
        <div
          ref={panelRef}
          className="
            fixed z-40 bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden
            bottom-[6.5rem] right-4 sm:right-6
            w-[calc(100vw-2rem)] sm:w-80
          "
          style={{ maxHeight: 'min(480px, 70vh)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center gap-2">
              <BookOpen size={14} className="text-gray-500" />
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Help for this page
              </p>
            </div>
            <span className="text-xs text-gray-400">{articles.length} article{articles.length !== 1 ? 's' : ''}</span>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: 'calc(min(480px, 70vh) - 96px)' }}>
            {openArticle ? (
              /* ── Single article view ── */
              <div>
                <button
                  onClick={() => setArticleId(null)}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-xs text-gray-400 hover:text-gray-700 transition-colors border-b border-gray-100 w-full text-left"
                >
                  ← Back to articles
                </button>
                <div className="px-4 py-4">
                  <h3 className="text-sm font-bold text-gray-900 mb-3 leading-snug">
                    {openArticle.title}
                  </h3>
                  <div className="text-xs text-gray-600 leading-relaxed space-y-1.5">
                    {openArticle.body.split('\n').map((line, i) => {
                      if (!line.trim()) return <div key={i} className="h-0.5" />;
                      if (line.trimStart().startsWith('- ')) return (
                        <div key={i} className="flex gap-1.5 items-start">
                          <span className="mt-1.5 h-1 w-1 rounded-full bg-gray-400 flex-shrink-0" />
                          <span>{line.replace(/^[-\s]+/, '')}</span>
                        </div>
                      );
                      if (/^\d+\.\s/.test(line.trimStart())) return (
                        <p key={i} className="font-medium text-gray-700">{line}</p>
                      );
                      return <p key={i}>{line}</p>;
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* ── Article list ── */
              <div className="divide-y divide-gray-50">
                {articles.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setArticleId(a.id)}
                    className="w-full text-left px-4 py-3.5 hover:bg-gray-50 transition-colors group"
                  >
                    <div className="flex items-start gap-2.5">
                      <div
                        className="mt-0.5 h-5 w-5 flex-shrink-0 rounded-md flex items-center justify-center"
                        style={{ backgroundColor: a.catColor + '20' }}
                      >
                        <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: a.catColor }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 group-hover:text-gray-700 leading-snug">
                          {a.title}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{preview(a.body)}</p>
                      </div>
                      <ChevronRight size={13} className="text-gray-300 flex-shrink-0 mt-0.5 group-hover:text-gray-500 transition-colors" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 px-4 py-2.5 flex items-center justify-between bg-gray-50">
            <button
              onClick={() => { setOpen(false); window.dispatchEvent(new Event('open-ask-ai')); }}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
            >
              <Sparkles size={12} />
              Ask AI
            </button>
            <button
              onClick={() => router.push('/dashboard/help')}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors"
            >
              <BookOpen size={11} />
              All help articles →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
