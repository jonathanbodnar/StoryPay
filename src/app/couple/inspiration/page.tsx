'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ImageIcon, CheckCircle2, AlertTriangle } from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';
import InspirationBoard, { type InspirationBoardHandle } from '@/components/wedding-inspiration/InspirationBoard';
import PinterestImportModal from '@/components/wedding-inspiration/PinterestImportModal';
import { EMPTY_INSPIRATION, type WeddingInspiration } from '@/lib/wedding-inspiration';

type PinterestStatus = { connected: boolean; username: string | null; configured: boolean };

export default function CoupleInspirationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20 text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <CoupleInspirationContent />
    </Suspense>
  );
}

function CoupleInspirationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const boardRef = useRef<InspirationBoardHandle>(null);

  const [loading, setLoading] = useState(true);
  const [needsLink, setNeedsLink] = useState(false);
  const [inspiration, setInspiration] = useState<WeddingInspiration>(EMPTY_INSPIRATION);
  const [pin, setPin] = useState<PinterestStatus>({ connected: false, username: null, configured: false });
  const [importOpen, setImportOpen] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const loadPinStatus = useCallback(async () => {
    const res = await coupleAuthedFetch('/api/couple/integrations/pinterest/status');
    const data = await res.json().catch(() => ({}));
    if (res.ok) setPin({ connected: !!data.connected, username: data.username ?? null, configured: !!data.configured });
  }, []);

  const load = useCallback(async () => {
    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/couple/login');
      return;
    }
    const res = await coupleAuthedFetch('/api/couple/inspiration');
    if (res.status === 401) {
      router.replace('/couple/login');
      return;
    }
    if (res.status === 409) {
      setNeedsLink(true);
      setLoading(false);
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (data.inspiration) setInspiration(data.inspiration as WeddingInspiration);
    await loadPinStatus();
    setLoading(false);
  }, [router, loadPinStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  // React to the Pinterest OAuth redirect result.
  useEffect(() => {
    const p = searchParams.get('pinterest');
    if (!p) return;
    if (p === 'connected') {
      setFlash({ kind: 'ok', msg: 'Pinterest connected. Import your boards below.' });
      void loadPinStatus();
    } else if (p === 'denied') {
      setFlash({ kind: 'err', msg: 'Pinterest connection was cancelled.' });
    } else if (p === 'error') {
      setFlash({ kind: 'err', msg: 'Could not connect Pinterest. Please try again.' });
    }
    router.replace('/couple/inspiration');
  }, [searchParams, router, loadPinStatus]);

  async function saveInspiration(next: WeddingInspiration) {
    const res = await coupleAuthedFetch('/api/couple/inspiration', {
      method: 'PUT',
      body: JSON.stringify({ inspiration: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) return { ok: false, conflict: true, inspiration: data.inspiration as WeddingInspiration | undefined };
    if (!res.ok) return { ok: false };
    return { ok: true, inspiration: data.inspiration as WeddingInspiration | undefined };
  }

  async function resolveLink(url: string) {
    const res = await coupleAuthedFetch('/api/couple/inspiration/resolve-link', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
    const data = await res.json().catch(() => ({}));
    const preview = data?.preview ?? {};
    return { imageUrl: preview.imageUrl ?? null, title: preview.title ?? null };
  }

  async function connectPinterest() {
    const res = await coupleAuthedFetch('/api/couple/integrations/pinterest/connect', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) {
      window.location.href = data.url as string;
    } else {
      setFlash({ kind: 'err', msg: typeof data.error === 'string' ? data.error : 'Pinterest is not available yet.' });
    }
  }

  async function disconnectPinterest() {
    await coupleAuthedFetch('/api/couple/integrations/pinterest/disconnect', { method: 'POST' });
    await loadPinStatus();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (needsLink) {
    return (
      <div>
        <h1 className="font-heading text-2xl text-gray-900">Inspiration board</h1>
        <div className="mt-8 rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
          <ImageIcon className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-600">Connect with your venue to start your inspiration board.</p>
          <Link
            href="/couple/wedding"
            className="mt-4 inline-flex rounded-2xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85"
          >
            Go to My wedding
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div>
        <h1 className="font-heading text-2xl text-gray-900">Inspiration board</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pull in your Pinterest boards and pins, or paste image links, so you and your venue are on the same page about
          your wedding style.
        </p>
      </div>

      {flash && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${
            flash.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          {flash.kind === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{flash.msg}</span>
        </div>
      )}

      <div className="mt-6">
        <InspirationBoard
          ref={boardRef}
          initial={inspiration}
          onSave={saveInspiration}
          resolveLink={resolveLink}
          pinterest={{
            configured: pin.configured,
            connected: pin.connected,
            username: pin.username,
            onConnect: () => void connectPinterest(),
            onImport: () => setImportOpen(true),
            onDisconnect: () => void disconnectPinterest(),
          }}
        />
      </div>

      <PinterestImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onAdd={(items) => boardRef.current?.addItems(items)}
      />
    </div>
  );
}
