import type { Metadata } from 'next';
import { Open_Sans, Playfair_Display } from 'next/font/google';
import './globals.css';
import { getPageSeo } from '@/lib/page-seo';
import PWAInstaller from '@/components/PWAInstaller';

// Self-hosted via next/font — eliminates the render-blocking Google Fonts request.
const openSans = Open_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-open-sans',
  display: 'swap',
});

const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-playfair',
  display: 'swap',
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getPageSeo('home');
  const title       = seo?.title        || 'StoryVenue™ — Wedding Venue Proposal & Payment Platform';
  const description = seo?.description  || 'StoryVenue is the all-in-one proposal and payment platform built for wedding venues. Send branded contracts, collect e-signatures, and get paid — all from one dashboard.';
  const ogImage     = seo?.og_image     || '/og-default.png';
  const ogTitle     = seo?.og_title     || title;
  const ogDesc      = seo?.og_description || description;

  return {
    metadataBase: new URL(APP_URL),
    title: { default: title, template: '%s | StoryVenue™' },
    description,
    keywords: ['wedding venue software', 'venue payment platform', 'wedding proposal software', 'venue management', 'wedding contracts', 'e-signature', 'venue billing'],
    authors: [{ name: 'StoryVenue', url: APP_URL }],
    creator: 'StoryVenue Marketing',
    publisher: 'StoryVenue Marketing',
    robots: seo?.noindex
      ? { index: false, follow: false }
      : { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
    openGraph: {
      type: 'website', locale: 'en_US', url: seo?.canonical || APP_URL, siteName: 'StoryVenue™',
      title: ogTitle, description: ogDesc,
      images: [{ url: ogImage, width: 1200, height: 630, alt: 'StoryVenue — Wedding Venue Payment Platform' }],
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
    name: 'StoryVenue',
    url: APP_URL,
    logo: `${APP_URL}/storyvenue-logo-dark.png`,
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
    name: 'StoryVenue',
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
    name: 'StoryVenue',
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
    // Apply the next/font CSS variable to <html> so --font-open-sans is
    // available on every element (including ::before / ::after pseudo-elements
    // and form controls that reset their inherited font). This guarantees
    // Open Sans is the default everywhere.
    <html lang="en" className={`${openSans.variable} ${playfairDisplay.variable}`}>
      <head>
        {/* Explicit favicon links override platform defaults (e.g. Railway) that ignore metadata alone */}
        <link rel="icon" href="/storyvenue-sidebar-mark.png" type="image/png" sizes="any" />
        <link rel="shortcut icon" href="/storyvenue-sidebar-mark.png" type="image/png" />
        <link rel="apple-touch-icon" href="/storyvenue-sidebar-mark.png" />
        {/* PWA — "Add to Home Screen" support */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1b1b1b" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="StoryVenue" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }} />
      </head>
      <body className="antialiased bg-white text-gray-900">
        {children}
        <PWAInstaller />
      </body>
    </html>
  );
}
