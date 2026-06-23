import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'You\u2019re offline',
  robots: { index: false, follow: false },
};

// Served by the service worker (public/sw.js) as the fallback for failed
// top-level navigations. Must be self-contained — no auth, no DB, no client
// JS — so it renders even when the network is fully down and the runtime
// cache is cold.
export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: "'Open Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        background: '#ffffff',
        color: '#1b1b1b',
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        {/* Plain <img> on purpose: next/image performs runtime fetches that
            can fail when the device is fully offline. This file is precached
            by the service worker, so a raw <img> always renders. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/storyvenue-dark-logo.png"
          alt="StoryVenue"
          width={160}
          height={40}
          style={{ margin: '0 auto 24px', display: 'block' }}
        />
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 10 }}>
          You&rsquo;re offline
        </h1>
        <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6, marginBottom: 24 }}>
          StoryVenue can&rsquo;t reach the network right now. Check your
          connection and try again — your data is safe on the server.
        </p>
        {/* Hard navigation on purpose: next/link does a client-side route
            that needs JS + working network. A plain anchor forces the
            browser to retry the network from scratch. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          style={{
            display: 'inline-block',
            padding: '10px 22px',
            borderRadius: 10,
            background: '#1b1b1b',
            color: '#ffffff',
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Try again
        </a>
      </div>
    </main>
  );
}
