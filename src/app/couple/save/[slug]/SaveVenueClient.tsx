'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Loader2, Heart, AlertCircle } from 'lucide-react';
import { getCoupleSupabase } from '@/lib/couple-browser';

/**
 * Allowlist of hosts we're willing to bounce back to after saving a venue.
 * Keeps the `?redirect=` param from being abused for phishing.
 */
const ALLOWED_REDIRECT_HOSTS = new Set<string>([
  'storyvenue.com',
  'www.storyvenue.com',
  // dev / preview
  'localhost',
  '127.0.0.1',
]);

function sanitizeRedirect(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!ALLOWED_REDIRECT_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

type Status = 'checking' | 'saving' | 'saved' | 'already' | 'error';

export function SaveVenueClient({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get('redirect');
  const safeRedirect = sanitizeRedirect(redirectParam);

  const [status, setStatus] = useState<Status>('checking');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = getCoupleSupabase();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        // Not logged in — send to login with a relative `next` that will bring
        // the bride right back here so the save can finish. The login form
        // only honors relative `next`, which is correct (prevents phishing);
        // the cross-origin bounce happens from this page after save.
        const next = `/couple/save/${encodeURIComponent(slug)}${
          redirectParam ? `?redirect=${encodeURIComponent(redirectParam)}` : ''
        }`;
        router.replace(`/couple/login?next=${encodeURIComponent(next)}`);
        return;
      }

      if (cancelled) return;
      setStatus('saving');

      let res: Response;
      try {
        res = await fetch('/api/couple/wishlist', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ slug }),
        });
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(e instanceof Error ? e.message : 'Network error');
        return;
      }

      if (cancelled) return;

      if (res.ok) {
        // If we have a safe redirect, bounce back immediately so the user
        // can keep browsing/saving venues without an interstitial page.
        if (safeRedirect) {
          window.location.assign(safeRedirect);
          return;
        }
        setStatus('saved');
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      // Treat the "already saved" case as success.
      if (/already|duplicate|unique/i.test(data.error ?? '')) {
        if (safeRedirect) {
          window.location.assign(safeRedirect);
          return;
        }
        setStatus('already');
        return;
      }

      setStatus('error');
      setErrorMsg(data.error || `Save failed (${res.status})`);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [slug, redirectParam, safeRedirect, router]);

  return (
    <div className="mx-auto max-w-md text-center">
      {status === 'checking' || status === 'saving' ? (
        <>
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-500" />
          <p className="mt-4 text-sm text-gray-600">
            {status === 'checking' ? 'Checking your login…' : 'Saving venue to your wish list…'}
          </p>
        </>
      ) : null}

      {(status === 'saved' || status === 'already') && (
        <>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <Heart className="h-6 w-6 fill-red-500 text-red-500" strokeWidth={0} />
          </div>
          <h1 className="mt-4 font-heading text-xl text-gray-900">
            {status === 'saved' ? 'Saved to your wish list' : 'Already on your wish list'}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            {safeRedirect
              ? 'Taking you back to the venue…'
              : 'Open your wish list to keep planning.'}
          </p>
          {!safeRedirect && (
            <Link
              href="/couple/dashboard"
              className="mt-6 inline-block rounded-2xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-medium text-white"
            >
              Go to dashboard
            </Link>
          )}
        </>
      )}

      {status === 'error' && (
        <>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <AlertCircle className="h-6 w-6 text-red-500" />
          </div>
          <h1 className="mt-4 font-heading text-xl text-gray-900">We couldn&apos;t save that venue</h1>
          <p className="mt-2 text-sm text-gray-600">{errorMsg || 'Please try again.'}</p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              href="/couple/dashboard"
              className="rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900"
            >
              Go to dashboard
            </Link>
            {safeRedirect && (
              <a
                href={safeRedirect}
                className="rounded-2xl bg-[#1b1b1b] px-4 py-2 text-sm font-medium text-white"
              >
                Back to venue
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}
