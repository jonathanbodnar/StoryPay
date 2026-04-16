import { supabaseAdmin } from '@/lib/supabase';
import { Metadata } from 'next';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';

interface PageSeoRow {
  page_key: string;
  title: string | null;
  description: string | null;
  og_image: string | null;
  og_title: string | null;
  og_description: string | null;
  noindex: boolean;
  canonical: string | null;
  schema_json: string | null;
}

export async function getPageSeo(key: string): Promise<PageSeoRow | null> {
  try {
    const { data } = await supabaseAdmin
      .from('page_seo')
      .select('*')
      .eq('page_key', key)
      .maybeSingle();
    return data ?? null;
  } catch {
    return null;
  }
}

export function buildMetadata(
  seo: PageSeoRow | null,
  defaults: { title: string; description: string; url: string; image?: string }
): Metadata {
  const title       = seo?.title        || defaults.title;
  const description = seo?.description  || defaults.description;
  const ogTitle     = seo?.og_title     || title;
  const ogDesc      = seo?.og_description || description;
  const image       = seo?.og_image     || defaults.image || '/og-default.png';
  const canonical   = seo?.canonical    || defaults.url;

  return {
    title,
    description,
    metadataBase: new URL(APP_URL),
    alternates: { canonical },
    robots: seo?.noindex
      ? { index: false, follow: false }
      : { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } },
    openGraph: {
      title: ogTitle,
      description: ogDesc,
      url: canonical,
      images: [{ url: image, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: ogDesc,
      images: [image],
    },
  };
}
