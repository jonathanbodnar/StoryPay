'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';

export function PdfThumbnail({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { destroy: () => void; promise: Promise<unknown> } | null = null;

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

        loadingTask = pdfjs.getDocument({ url });
        const pdf = (await loadingTask.promise) as {
          getPage: (n: number) => Promise<{
            getViewport: (opts: { scale: number }) => { width: number; height: number };
            render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
          }>;
        };
        if (cancelled) return;

        const page = await pdf.getPage(1);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: 0.5 });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setLoaded(true);
      } catch (err) {
        console.error('[PdfThumbnail] render failed', err);
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
      try {
        loadingTask?.destroy();
      } catch {
        /* noop */
      }
    };
  }, [url]);

  return (
    <div className="relative flex h-28 w-full flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-gray-100 to-gray-50 text-gray-400">
      {!loaded && <FileText className={`h-7 w-7 ${!error ? 'animate-pulse' : ''}`} />}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {loaded && (
        <div className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white backdrop-blur-sm">
          PDF
        </div>
      )}
    </div>
  );
}
