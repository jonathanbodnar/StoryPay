'use client';

import { useEffect, useState } from 'react';
import { useRef } from 'react';
import {
  Settings,
  LinkIcon,
  CheckCircle2,
  Building2,
  CreditCard,
  MessageSquare,
  Loader2,
  ExternalLink,
  Palette,
  Save,
  Upload,
  ImageIcon,
  X,
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
  ghl_location_id: string | null;
  lunarpay_merchant_id: number | null;
  service_fee_rate: number;
  brand_logo_url: string | null;
  brand_tagline: string | null;
  brand_website: string | null;
  brand_color: string | null;
  brand_email: string | null;
  brand_phone: string | null;
  brand_address: string | null;
  brand_city: string | null;
  brand_state: string | null;
  brand_zip: string | null;
  brand_footer_note: string | null;
}

const INPUT = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:bg-white transition-colors';
const LABEL = 'block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide';

export default function SettingsPage() {
  const [venue, setVenue] = useState<VenueInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [feeSaving, setFeeSaving] = useState(false);
  const [feeSaved, setFeeSaved] = useState(false);
  const [feeInput, setFeeInput] = useState('2.75');
  const [brandSaving, setBrandSaving] = useState(false);
  const [brandSaved, setBrandSaved] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState('');
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [brand, setBrand] = useState({
    brand_logo_url: '',
    brand_tagline: '',
    brand_website: '',
    brand_color: '#1b1b1b',
    brand_email: '',
    brand_phone: '',
    brand_address: '',
    brand_city: '',
    brand_state: '',
    brand_zip: '',
    brand_footer_note: '',
  });

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/venues/me');
        if (res.ok) {
          const data = await res.json();
          setVenue(data);
          setFeeInput(String(data.service_fee_rate ?? 2.75));
          setBrand({
            brand_logo_url: data.brand_logo_url || '',
            brand_tagline: data.brand_tagline || '',
            brand_website: data.brand_website || '',
            brand_color: data.brand_color || '#1b1b1b',
            brand_email: data.brand_email || '',
            brand_phone: data.brand_phone || '',
            brand_address: data.brand_address || '',
            brand_city: data.brand_city || '',
            brand_state: data.brand_state || '',
            brand_zip: data.brand_zip || '',
            brand_footer_note: data.brand_footer_note || '',
          });
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function saveBranding() {
    setBrandSaving(true);
    try {
      const res = await fetch('/api/venues/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(brand),
      });
      if (res.ok) {
        const updated = await res.json();
        setVenue(prev => prev ? { ...prev, ...updated } : prev);
        setBrandSaved(true);
        setTimeout(() => setBrandSaved(false), 3000);
      }
    } finally {
      setBrandSaving(false);
    }
  }

  const upd = (k: keyof typeof brand) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setBrand(p => ({ ...p, [k]: e.target.value }));

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    setLogoError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/venues/upload-logo', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setLogoError(data.error || 'Upload failed'); return; }
      setBrand(p => ({ ...p, brand_logo_url: data.url }));
      // Also persist immediately
      await fetch('/api/venues/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_logo_url: data.url }),
      });
      setBrandSaved(true);
      setTimeout(() => setBrandSaved(false), 3000);
    } catch {
      setLogoError('Upload failed. Please try again.');
    } finally {
      setLogoUploading(false);
      if (e.target) e.target.value = '';
    }
  }

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

  const saveServiceFee = async () => {
    const rate = parseFloat(feeInput);
    if (isNaN(rate) || rate < 0 || rate > 99) return;
    setFeeSaving(true);
    try {
      const res = await fetch('/api/venues/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_fee_rate: rate }),
      });
      if (res.ok) {
        setVenue((prev) => prev ? { ...prev, service_fee_rate: rate } : prev);
        setFeeSaved(true);
        setTimeout(() => setFeeSaved(false), 3000);
      }
    } finally {
      setFeeSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your venue configuration and integrations</p>
      </div>

      <div className="space-y-6">

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
            {venue.ghl_connected || venue.ghl_location_id ? (
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
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-900/10">
                  <LinkIcon size={20} className="text-brand-900" />
                </div>
                <p className="text-sm font-medium text-gray-900">Connect Messaging</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
                  Link your messaging account to automatically send SMS notifications to customers
                  when proposals are created.
                </p>
                <a
                  href="/api/messaging/connect"
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
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
