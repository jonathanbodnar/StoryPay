'use client';

/**
 * Lead Finder, on a page of its own under the Bride Booking System (owner's
 * ask, Oct 5 2026; it used to be reached only through Settings → Integrations,
 * where the same card still is).
 */

import Link from 'next/link';
import { ArrowLeft, MailSearch } from 'lucide-react';
import LeadFinderCard from '@/components/leadfinder/LeadFinderCard';

export default function LeadFinderPage() {
  return (
    <div className="space-y-6 py-6 sm:py-8" data-testid="lead-finder-page">
      <div>
        <Link href="/dashboard/listing" className="mb-2 inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700">
          <ArrowLeft size={14} /> Back to listing
        </Link>
        <h1 className="font-heading flex items-center gap-2 text-2xl text-gray-900">
          <MailSearch size={22} /> Lead Finder
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Inquiries from The Knot, WeddingWire, Zola and other directories usually sit in your email. Lead Finder
          brings them into your Lead Inbox, so every bride gets your pricing guide and follow-up, wherever she found you.
        </p>
      </div>
      <LeadFinderCard />
    </div>
  );
}
