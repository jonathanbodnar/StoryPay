'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Inline PDF endpoint (e.g. /api/public/venue/[id]/pricing-guide) */
  pdfUrl: string;
  /** Same endpoint with ?dl=1 to force a download */
  downloadUrl: string;
  venueName: string;
}

/**
 * Renders the pricing-guide PDF *inline* on mobile by rasterising each page to
 * a <canvas> with pdf.js. Mobile browsers (iOS Safari especially) won't render
 * a multi-page PDF inside an <iframe>, so without this they'd be stuck with a
 * "tap to download" card. If rendering fails for any reason we fall back to the
 * same download / open-in-browser card so the lead is never blocked.
 */
export default function InlinePdfGuide({ pdfUrl, downloadUrl, venueName }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { destroy: () => void; promise: Promise<{ numPages: number; getPage: (n: number) => Promise<import('pdfjs-dist').PDFPageProxy> }> } | null = null;

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        // Self-pinned worker matching the installed version.
        pdfjs.GlobalWorkerOptions.workerSrc =
          `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

        loadingTask = pdfjs.getDocument({ url: pdfUrl });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';

        const targetWidth = Math.min(container.clientWidth || 600, 900);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const base = page.getViewport({ scale: 1 });
          const scale = targetWidth / base.width;
          const viewport = page.getViewport({ scale: scale * dpr });

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.style.display = 'block';
          canvas.style.margin = '0 auto 12px';
          canvas.style.borderRadius = '6px';
          canvas.style.boxShadow = '0 1px 6px rgba(0,0,0,0.12)';
          canvas.style.background = '#fff';

          container.appendChild(canvas);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }

        if (!cancelled) setStatus('ready');
      } catch (err) {
        console.error('[InlinePdfGuide] render failed', err);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      try { loadingTask?.destroy(); } catch { /* noop */ }
    };
  }, [pdfUrl]);

  if (status === 'error') {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '48px 24px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, lineHeight: 1 }}>📄</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#1b1b1b', marginBottom: 6 }}>
            {venueName} — Pricing Guide
          </div>
          <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 24 }}>
            Tap the button below to open or save the full Pricing &amp; Availability Guide.
          </div>
        </div>
        <a
          href={downloadUrl}
          download
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#1b1b1b', color: '#fff', fontWeight: 700, fontSize: 15,
            borderRadius: 12, padding: '14px 28px', textDecoration: 'none',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download Pricing Guide
        </a>
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 13, color: '#6b7280', textDecoration: 'underline' }}
        >
          Open in browser instead
        </a>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 12px 32px' }}>
      {status === 'loading' && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 12, padding: '64px 24px', color: '#6b7280',
        }}>
          <div style={{
            width: 28, height: 28, border: '3px solid #e5e7eb',
            borderTopColor: '#1b1b1b', borderRadius: '50%',
            animation: 'spv-spin 0.8s linear infinite',
          }} />
          <div style={{ fontSize: 13 }}>Loading your guide…</div>
          <style>{`@keyframes spv-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      <div ref={containerRef} />
      {status === 'ready' && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <a
            href={downloadUrl}
            download
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: '#1b1b1b', color: '#fff', fontWeight: 700, fontSize: 14,
              borderRadius: 10, padding: '12px 24px', textDecoration: 'none',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download PDF
          </a>
        </div>
      )}
    </div>
  );
}
