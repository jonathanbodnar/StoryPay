import type { Metadata } from 'next';
import './globals.css';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: 'StoryPay™ — Wedding Venue Proposal & Payment Platform',
    template: '%s | StoryPay™',
  },
  description: 'StoryPay is the all-in-one proposal and payment platform built for wedding venues. Send branded contracts, collect e-signatures, and get paid — all from one dashboard.',
  keywords: ['wedding venue software', 'venue payment platform', 'wedding proposal software', 'venue management', 'wedding contracts', 'e-signature', 'venue billing'],
  authors: [{ name: 'StoryPay', url: APP_URL }],
  creator: 'StoryVenue Marketing',
  publisher: 'StoryVenue Marketing',
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: APP_URL,
    siteName: 'StoryPay™',
    title: 'StoryPay™ — Wedding Venue Proposal & Payment Platform',
    description: 'Send branded proposals, collect e-signatures, and get paid. The payment platform built for wedding venues.',
    images: [{ url: '/og-default.png', width: 1200, height: 630, alt: 'StoryPay — Wedding Venue Payment Platform' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'StoryPay™ — Wedding Venue Proposal & Payment Platform',
    description: 'Send branded proposals, collect e-signatures, and get paid. The payment platform built for wedding venues.',
    images: ['/og-default.png'],
    creator: '@storypay',
  },
  alternates: {
    canonical: APP_URL,
  },
  icons: {
    icon: [{ url: '/favicon.ico' }],
    apple: '/apple-touch-icon.png',
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || '',
  },
};

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
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }} />
      </head>
      <body className="antialiased bg-white text-gray-900">{children}</body>
    </html>
  );
}
