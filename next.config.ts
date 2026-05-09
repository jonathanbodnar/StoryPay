import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ── Image optimization ───────────────────────────────────────────────────
  // Allow next/image to optimise remote images from these origins.
  // Adds format negotiation (WebP/AVIF) + lazy-loading automatically.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: '**.supabase.in' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },     // Google profile photos
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: '**.googleusercontent.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'uploadthing.com' },
      { protocol: 'https', hostname: '**.uploadthing.com' },
      { protocol: 'https', hostname: '**.ufs.sh' },
      { protocol: 'https', hostname: 'storyvenue.com' },
      { protocol: 'https', hostname: '**.storyvenue.com' },
    ],
    // Prefer modern formats — Cloudflare will serve them to supported browsers.
    formats: ['image/avif', 'image/webp'],
    // Increase the default 1000px device size list to cover retina/4K screens.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
  },

  async headers() {
    return [
      // ── Global security headers (apply to every response) ─────────────────
      // HSTS: force HTTPS for 1 year, including subdomains. Cloudflare may
      // also set this; defining at the origin protects direct Railway hits.
      // X-Content-Type-Options: prevents MIME-sniffing.
      // Referrer-Policy: strip referrer on cross-origin nav.
      // Permissions-Policy: deny camera/mic/geolocation/payment APIs to
      // anything we don't explicitly need.
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options",   value: "nosniff" },
          { key: "Referrer-Policy",          value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",       value: "camera=(), microphone=(), geolocation=(self), payment=(self)" },
        ],
      },
      // ── Authenticated areas — deny iframe embedding ───────────────────────
      // Prevents clickjacking on /dashboard and /admin. Public pages and
      // /embed/* must remain iframable so we don't apply this globally.
      {
        source: "/dashboard/:path*",
        headers: [
          { key: "X-Frame-Options",         value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [
          { key: "X-Frame-Options",         value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
      // ── Immutable hashed static assets ────────────────────────────────────
      // Next.js content-hashes every file under /_next/static so a 1-year TTL
      // is safe — a new deploy always produces new URLs.
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      // ── Public brand assets (logos, icons) ────────────────────────────────
      // These don't change often; 7-day TTL with 1-day stale-while-revalidate
      // keeps Cloudflare edge copies warm without serving stale logos too long.
      {
        source: "/:file(.*\\.(?:png|jpg|jpeg|webp|avif|svg|ico))",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=86400",
          },
        ],
      },
      // ── Self-hosted fonts (when /public/fonts/* is populated) ─────────────
      {
        source: "/:file(.*\\.(?:woff2?|ttf|otf|eot))",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      // ── Public unauthenticated API — safe to CDN-cache briefly ────────────
      // Venue directory + individual venue profiles are read-only, no auth.
      // 60-second shared cache + 5-minute stale-while-revalidate lets
      // Cloudflare serve hot venue pages without hammering Railway.
      {
        source: "/api/public/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=60, stale-while-revalidate=300",
          },
        ],
      },
      // ── Blog API ──────────────────────────────────────────────────────────
      {
        source: "/api/blog",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=300, stale-while-revalidate=3600",
          },
        ],
      },
      // ── All authenticated API routes — must NOT be stored at CDN ─────────
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store",
          },
        ],
      },
      // ── Dashboard pages — user-specific, never cache at CDN ───────────────
      {
        source: "/dashboard/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, no-cache",
          },
        ],
      },
      // ── Embed iframes (listing reviews) ───────────────────────────────────
      {
        source: "/embed/listing-reviews/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://storyvenue.com https://www.storyvenue.com http://localhost:* http://127.0.0.1:*",
          },
          {
            key: "Cache-Control",
            value: "public, s-maxage=30, stale-while-revalidate=120",
          },
        ],
      },
      // ── Embeddable forms — allow any domain to iframe (that's the point) ──
      {
        source: "/embed/form/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *",
          },
          {
            key: "X-Frame-Options",
            value: "ALLOWALL",
          },
          {
            key: "Cache-Control",
            value: "public, s-maxage=30, stale-while-revalidate=120",
          },
        ],
      },
    ];
  },

  async redirects() {
    return [
      // Upgrade to permanent=true — browsers + CDNs will cache the 301 and
      // stop hitting the origin for these legacy paths entirely.
      { source: "/favicon.ico", destination: "/storyvenue-sidebar-mark.png", permanent: true },
      { source: "/dashboard/customers", destination: "/dashboard/contacts", permanent: true },
      { source: "/dashboard/customers/:id", destination: "/dashboard/contacts/:id", permanent: true },
      // AI Concierge moved from settings → marketing (May 2026). Forward
      // bookmarks + any old email CTAs.
      { source: "/dashboard/settings/ai-concierge", destination: "/dashboard/marketing/ai-concierge", permanent: true },
    ];
  },
};

export default nextConfig;
