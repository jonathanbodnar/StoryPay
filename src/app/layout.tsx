import type { Metadata } from 'next';
import './globals.css';
import { getPageSeo } from '@/lib/page-seo';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getPageSeo('home');
  const title       = seo?.title        || 'StoryPay™ — Wedding Venue Proposal & Payment Platform';
  const description = seo?.description  || 'StoryPay is the all-in-one proposal and payment platform built for wedding venues. Send branded contracts, collect e-signatures, and get paid — all from one dashboard.';
  const ogImage     = seo?.og_image     || '/og-default.png';
  const ogTitle     = seo?.og_title     || title;
  const ogDesc      = seo?.og_description || description;

  return {
    metadataBase: new URL(APP_URL),
    title: { default: title, template: '%s | StoryPay™' },
    description,
    keywords: ['wedding venue software', 'venue payment platform', 'wedding proposal software', 'venue management', 'wedding contracts', 'e-signature', 'venue billing'],
    authors: [{ name: 'StoryPay', url: APP_URL }],
    creator: 'StoryVenue Marketing',
    publisher: 'StoryVenue Marketing',
    robots: seo?.noindex
      ? { index: false, follow: false }
      : { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
    openGraph: {
      type: 'website', locale: 'en_US', url: seo?.canonical || APP_URL, siteName: 'StoryPay™',
      title: ogTitle, description: ogDesc,
      images: [{ url: ogImage, width: 1200, height: 630, alt: 'StoryPay — Wedding Venue Payment Platform' }],
    },
    twitter: {
      card: 'summary_large_image', title: ogTitle, description: ogDesc,
      images: [ogImage], creator: '@storypay',
    },
    alternates: { canonical: seo?.canonical || APP_URL },
    // 2-letter mark in public/ — also copied to src/app/icon.png for Next file convention
    icons: {
      icon: [
        { url: '/storyvenue-sidebar-mark.png', type: 'image/png', sizes: '32x32' },
        { url: '/storyvenue-sidebar-mark.png', type: 'image/png', sizes: 'any' },
      ],
      shortcut: '/storyvenue-sidebar-mark.png',
      apple: '/storyvenue-sidebar-mark.png',
    },
    verification: { google: process.env.GOOGLE_SITE_VERIFICATION || '' },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const orgSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'StoryPay',
    url: APP_URL,
    logo: `${APP_URL}/storypay-logo-dark.png`,
    description: 'Wedding venue proposal and payment platform',
    contactPoint: {
      '@type': 'ContactPoint',
      email: 'clients@storyvenuemarketing.com',
      contactType: 'customer support',
    },
    sameAs: ['https://storyvenue.com'],
  };

  const websiteSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'StoryPay',
    url: APP_URL,
    description: 'Wedding venue proposal and payment platform',
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${APP_URL}/blog?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };

  const softwareSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'StoryPay',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: APP_URL,
    description: 'All-in-one proposal, contract, and payment platform for wedding venues.',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      description: 'Contact for pricing',
    },
    featureList: [
      'Branded proposal creation',
      'E-signature collection',
      'Online payment processing',
      'Invoice generation',
      'Customer management',
      'Email templates',
      'Team management',
      'Financial reports',
    ],
  };

  return (
    <html lang="en">
      <head>
        {/* Explicit favicon links override platform defaults (e.g. Railway) that ignore metadata alone */}
        <link rel="icon" href="/storyvenue-sidebar-mark.png" type="image/png" sizes="any" />
        <link rel="shortcut icon" href="/storyvenue-sidebar-mark.png" type="image/png" />
        <link rel="apple-touch-icon" href="/storyvenue-sidebar-mark.png" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }} />
      </head>
      <body className="antialiased bg-white text-gray-900">{children}</body>
    </html>
  );
}
