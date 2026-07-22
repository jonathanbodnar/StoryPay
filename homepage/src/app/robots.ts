import { MetadataRoute } from 'next';

const SITE_URL = (
  process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'https://storyvenue.com'
).replace(/\/$/, '');

/**
 * Robots: open the whole public site to search engines AND AI answer-engine
 * crawlers (AEO). Only the API surface is disallowed.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Search engines + everything else
      { userAgent: '*', allow: '/', disallow: ['/api/'] },
      // AI answer engines — explicitly welcomed so listings can be cited in
      // ChatGPT / Claude / Perplexity answers.
      { userAgent: 'GPTBot',            allow: '/', disallow: ['/api/'] },
      { userAgent: 'OAI-SearchBot',     allow: '/', disallow: ['/api/'] },
      { userAgent: 'ChatGPT-User',      allow: '/', disallow: ['/api/'] },
      { userAgent: 'ClaudeBot',         allow: '/', disallow: ['/api/'] },
      { userAgent: 'Claude-SearchBot',  allow: '/', disallow: ['/api/'] },
      { userAgent: 'PerplexityBot',     allow: '/', disallow: ['/api/'] },
      { userAgent: 'Google-Extended',   allow: '/', disallow: ['/api/'] },
      { userAgent: 'Bingbot',           allow: '/', disallow: ['/api/'] },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
