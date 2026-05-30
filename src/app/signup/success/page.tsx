'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { CheckCircle2 } from 'lucide-react';
import Script from 'next/script';

/**
 * /signup/success — Conversion tracking landing page.
 *
 * Every new account (free + paid) flows through this URL after registration.
 * Use this as the destination URL in Google Ads, Meta Ads, or any other
 * tracking platform that needs a unique page to fire a conversion on.
 *
 * Query params forwarded from the signup flow:
 *   plan=free|paid   — differentiates free vs paid signups for reporting
 *
 * Tracking IDs are read from env vars (set in Railway):
 *   NEXT_PUBLIC_GOOGLE_ADS_ID        e.g. AW-XXXXXXXXX
 *   NEXT_PUBLIC_GOOGLE_ADS_CONV_LABEL e.g. abcDEFghijk  (optional, fires event conversion)
 *   NEXT_PUBLIC_META_PIXEL_ID        e.g. 1234567890
 *   NEXT_PUBLIC_GA4_MEASUREMENT_ID   e.g. G-XXXXXXXXXX
 */

const GOOGLE_ADS_ID    = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID ?? '';
const GOOGLE_ADS_LABEL = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONV_LABEL ?? '';
const META_PIXEL_ID    = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '';
const GA4_ID           = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID ?? '';

// Redirect to dashboard after showing success for this long.
// Kept at 3.5 s to give tracking beacons enough time to flush
// before the page navigates away.
const REDIRECT_DELAY_MS = 3500;

export default function SignupSuccessPage() {
  return (
    <Suspense>
      <SuccessInner />
    </Suspense>
  );
}

function SuccessInner() {
  const router      = useRouter();
  const searchParams = useSearchParams();
  const plan        = searchParams.get('plan') ?? 'free';
  const fired       = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    function fireEvents() {
      // ── Google Ads conversion ────────────────────────────────────────────
      if (GOOGLE_ADS_ID && 'gtag' in window) {
        const g = (window as unknown as { gtag: (...a: unknown[]) => void }).gtag;
        if (GOOGLE_ADS_LABEL) {
          g('event', 'conversion', {
            send_to: `${GOOGLE_ADS_ID}/${GOOGLE_ADS_LABEL}`,
            value: plan === 'paid' ? 1.0 : 0.0,
            currency: 'USD',
          });
        }
        g('event', 'sign_up', { method: 'StoryVenue', plan });
      }

      // ── GA4 custom event ─────────────────────────────────────────────────
      if (GA4_ID && 'gtag' in window) {
        const g = (window as unknown as { gtag: (...a: unknown[]) => void }).gtag;
        g('event', 'registration_complete', { plan });
      }

      // ── Meta Pixel ───────────────────────────────────────────────────────
      if (META_PIXEL_ID && 'fbq' in window) {
        const fbq = (window as unknown as { fbq: (...a: unknown[]) => void }).fbq;
        // PageView was already fired by the inline script below; just send
        // the conversion event here.
        fbq('track', 'CompleteRegistration', {
          content_name: plan,
          currency: 'USD',
          value: plan === 'paid' ? 1.0 : 0.0,
        });
        console.log('[StoryVenue] Meta CompleteRegistration fired', { plan });
      }
    }

    // Give tracking scripts up to 1.5 s to initialise, then fire regardless.
    // This avoids the race where fbq/gtag scripts load after the useEffect runs.
    let attempts = 0;
    const poll = setInterval(() => {
      const metaReady = !META_PIXEL_ID || 'fbq' in window;
      const gtagReady = !(GOOGLE_ADS_ID || GA4_ID) || 'gtag' in window;
      attempts++;
      if ((metaReady && gtagReady) || attempts >= 15) {
        clearInterval(poll);
        fireEvents();
      }
    }, 100);

    // Redirect to dashboard onboarding after a brief success moment
    const t = setTimeout(() => {
      router.replace('/dashboard?welcome=1');
    }, REDIRECT_DELAY_MS);

    return () => {
      clearInterval(poll);
      clearTimeout(t);
    };
  }, [plan, router]);

  // ── Tracking scripts (loaded only when IDs are configured) ───────────────
  const hasGtag = Boolean(GOOGLE_ADS_ID || GA4_ID);
  const gtagId  = GA4_ID || GOOGLE_ADS_ID;

  return (
    <>
      {/* Google tag — injected only when an ID is configured */}
      {hasGtag && gtagId && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${gtagId}`}
            strategy="afterInteractive"
          />
          <Script id="gtag-init" strategy="afterInteractive">{`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            ${GA4_ID ? `gtag('config', '${GA4_ID}');` : ''}
            ${GOOGLE_ADS_ID ? `gtag('config', '${GOOGLE_ADS_ID}');` : ''}
          `}</Script>
        </>
      )}

      {/* PageView fires from the site-wide pixel in layout.tsx.
          No duplicate init needed here — just the CompleteRegistration
          event is fired from the useEffect above. */}

      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="mb-8">
          <Image src="/storyvenue-logo-dark.png" alt="StoryVenue" width={120} height={30} />
        </div>

        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm text-center">
          <CheckCircle2 size={44} className="mx-auto mb-4 text-emerald-500" />
          <h2 className="text-xl font-semibold text-gray-900">Welcome to StoryVenue!</h2>
          <p className="mt-2 text-sm text-gray-500">
            Your account is ready. Taking you to your dashboard…
          </p>

          <div className="mt-6 flex justify-center">
            <span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
              <span
                className="block h-full rounded-full bg-emerald-500"
                style={{
                  width: '100%',
                  animation: `progress ${REDIRECT_DELAY_MS}ms linear forwards`,
                }}
              />
            </span>
          </div>
        </div>

        <p className="mt-6 text-xs text-gray-400">
          Not redirecting?{' '}
          <button
            type="button"
            onClick={() => router.replace('/dashboard?welcome=1')}
            className="underline hover:text-gray-600"
          >
            Click here
          </button>
        </p>
      </div>

      <style>{`
        @keyframes progress {
          from { transform: translateX(-100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
