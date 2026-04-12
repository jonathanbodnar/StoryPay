import { MetadataRoute } from 'next';
import { supabaseAdmin } from '@/lib/supabase';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: APP_URL,           lastModified: new Date(), changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${APP_URL}/blog`, lastModified: new Date(), changeFrequency: 'daily',   priority: 0.9 },
    { url: `${APP_URL}/login`,lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${APP_URL}/privacy`,lastModified: new Date(), changeFrequency: 'yearly',priority: 0.3 },
    { url: `${APP_URL}/terms`,  lastModified: new Date(), changeFrequency: 'yearly',priority: 0.3 },
  ];

  try {
    const { data: posts } = await supabaseAdmin
      .from('blog_posts')
      .select('slug, updated_at')
      .eq('status', 'published');

    const blogPages: MetadataRoute.Sitemap = (posts ?? []).map((p: { slug: string; updated_at: string }) => ({
      url: `${APP_URL}/blog/${p.slug}`,
      lastModified: new Date(p.updated_at),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));

    return [...staticPages, ...blogPages];
  } catch {
    return staticPages;
  }
}
