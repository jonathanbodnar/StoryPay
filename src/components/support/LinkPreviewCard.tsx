'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Image as ImageIcon } from 'lucide-react';

const URL_RE = /(https?:\/\/[^\s<]+)/i;

/** First http(s) URL found in a message body, or null. */
export function firstUrlIn(text: string): string | null {
  const m = URL_RE.exec(text || '');
  if (!m) return null;
  // Trim common trailing punctuation that isn't part of the URL.
  return m[1].replace(/[),.;!?]+$/, '');
}

interface PreviewData {
  ok: boolean;
  url?: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
}

const cache = new Map<string, PreviewData>();

/** Proxy an OG image URL through our server to avoid hotlink/CORS failures. */
function proxyImageUrl(src: string): string {
  return `/api/link-preview-image?url=${encodeURIComponent(src)}`;
}

/**
 * Fetches OG metadata for the first URL in a message body via the
 * server-side /api/link-preview route and renders a small card. Falls back
 * to a plain clickable link (never raw unlinked text) when metadata isn't
 * available or the fetch fails.
 */
export function LinkPreviewCard({ url }: { url: string }) {
  const [data, setData] = useState<PreviewData | null>(() => cache.get(url) ?? null);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
    let cancelled = false;
    const cached = cache.get(url);
    if (cached) {
      // Resolve on a microtask so this stays an async callback (not a
      // synchronous setState-in-effect-body), while still updating state
      // for the case where `url` changed without the component remounting.
      Promise.resolve().then(() => { if (!cancelled) setData(cached); });
      return () => { cancelled = true; };
    }
    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { cache: 'force-cache' })
      .then(r => r.json())
      .then((d: PreviewData) => {
        if (cancelled) return;
        cache.set(url, d);
        setData(d);
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = { ok: false };
        cache.set(url, fallback);
        setData(fallback);
      });
    return () => { cancelled = true; };
  }, [url]);

  if (!data || !data.ok || (!data.title && !data.image)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-current underline decoration-current/40 underline-offset-2 hover:decoration-current break-all"
      >
        {url} <ExternalLink size={10} className="shrink-0 opacity-60" />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mt-1.5 flex items-stretch gap-2 overflow-hidden rounded-lg border border-black/10 bg-white/70 hover:bg-white transition-colors max-w-sm"
    >
      {data.image && !imgFailed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={proxyImageUrl(data.image)}
          alt=""
          className="h-16 w-16 shrink-0 object-cover"
          onError={() => setImgFailed(true)}
        />
      )}
      {data.image && imgFailed && (
        <div className="h-16 w-16 shrink-0 flex items-center justify-center bg-gray-100 text-gray-300">
          <ImageIcon size={20} />
        </div>
      )}
      <div className="min-w-0 py-1.5 pr-2 flex flex-col justify-center">
        {data.title && <p className="truncate text-[12px] font-semibold text-gray-800">{data.title}</p>}
        {data.description && <p className="line-clamp-2 text-[11px] text-gray-500">{data.description}</p>}
        <p className="truncate text-[10px] text-gray-400 mt-0.5">{url}</p>
      </div>
    </a>
  );
}
