'use client';

import { useEffect, useState } from 'react';
import {
  Settings,
  LinkIcon,
  CheckCircle2,
  Building2,
  CreditCard,
  MessageSquare,
  Loader2,
  ExternalLink,
} from 'lucide-react';

interface VenueInfo {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  onboarding_status: string | null;
  ghl_connected: boolean;
  lunarpay_merchant_id: number | null;
}

export default function SettingsPage() {
  const [venue, setVenue] = useState<VenueInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/venues/me');
        if (res.ok) {
          setVenue(await res.json());
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  if (!venue) {
    return (
      <div className="py-20 text-center text-gray-500">Unable to load venue settings.</div>
    );
  }

  const isActive = venue.onboarding_status === 'active';

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your venue configuration and integrations</p>
      </div>

      <div className="space-y-6">
        {/* Venue Info */}
        <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-4">
            <Building2 size={18} className="text-gray-400" />
            <h2 className="font-heading text-base font-semibold text-gray-900">Venue Information</h2>
          </div>
          <div className="px-6 py-5">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-gray-400">Name</dt>
                <dd className="mt-1 text-gray-900">{venue.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-gray-400">Email</dt>
                <dd className="mt-1 text-gray-900">{venue.email || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-gray-400">Phone</dt>
                <dd className="mt-1 text-gray-900">{venue.phone || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-gray-400">Address</dt>
                <dd className="mt-1 text-gray-900">
                  {venue.address
                    ? `${venue.address}, ${venue.city || ''} ${venue.state || ''} ${venue.zip || ''}`
                    : '—'}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* Payment Processing */}
        <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-4">
            <CreditCard size={18} className="text-gray-400" />
            <h2 className="font-heading text-base font-semibold text-gray-900">Payment Processing</h2>
          </div>
          <div className="px-6 py-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">LunarPay</p>
                <p className="mt-0.5 text-sm text-gray-500">
                  {isActive
                    ? 'Your merchant account is active and ready to process payments.'
                    : venue.onboarding_status === 'bank_information_sent'
                    ? 'Your application is under review. This typically takes 24–48 hours.'
                    : 'Complete onboarding to start accepting payments.'}
                </p>
              </div>
              <div className="shrink-0 ml-4">
                {isActive ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 size={14} />
                    Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                    {venue.onboarding_status === 'bank_information_sent' ? 'Under Review' : 'Pending'}
                  </span>
                )}
              </div>
            </div>
            {venue.lunarpay_merchant_id && (
              <p className="mt-3 text-xs text-gray-400">
                Merchant ID: {venue.lunarpay_merchant_id}
              </p>
            )}
          </div>
        </section>

        {/* Messaging Integration */}
        <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-4">
            <MessageSquare size={18} className="text-gray-400" />
            <h2 className="font-heading text-base font-semibold text-gray-900">Messaging</h2>
          </div>
          <div className="px-6 py-5">
            {venue.ghl_connected ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">Connected</p>
                  <p className="mt-0.5 text-sm text-gray-500">
                    Your messaging account is connected. SMS notifications will be sent automatically
                    when proposals are created.
                  </p>
                </div>
                <span className="shrink-0 ml-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  <CheckCircle2 size={14} />
                  Connected
                </span>
              </div>
            ) : (
              <div className="text-center py-4">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-teal-500/10">
                  <LinkIcon size={20} className="text-teal-600" />
                </div>
                <p className="text-sm font-medium text-gray-900">Connect Messaging</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
                  Link your messaging account to automatically send SMS notifications to customers
                  when proposals are created.
                </p>
                <a
                  href="/api/messaging/connect"
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-600"
                >
                  <ExternalLink size={16} />
                  Connect Account
                </a>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
