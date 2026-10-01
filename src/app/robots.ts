import { MetadataRoute } from 'next';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';

// Worked out per request, so the test copy's rules never depend on its build.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  // The test copy is never indexed.
  if (process.env.APP_ENV === 'staging') return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/blog', '/blog/', '/privacy', '/terms', '/login'],
        disallow: ['/dashboard', '/api/', '/admin', '/setup', '/invite/'],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}
