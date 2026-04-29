'use client';

import { Zap } from 'lucide-react';

/**
 * Integrations page — currently showing a "Coming Soon" placeholder.
 *
 * Accounting (QuickBooks, FreshBooks) and calendar (Calendly, iCal) integrations
 * are temporarily hidden while they move to their permanent home in the app.
 * Restore the full UI from git history when ready to re-enable.
 */
export default function IntegrationsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-2xl text-gray-900">Integrations</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect your tools to sync data automatically with StoryVenue.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white py-20 px-6 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
          <Zap size={28} className="text-gray-400" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-gray-900">Integrations Coming Soon</h2>
        <p className="max-w-sm text-sm text-gray-500 leading-relaxed">
          We&apos;re building powerful integrations to connect StoryVenue with your favourite tools.
          Check back soon for calendar sync, accounting software, and more.
        </p>
      </div>
    </div>
  );
}
