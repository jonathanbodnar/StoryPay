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
    brand_color: '#293745',
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
            brand_color: data.brand_color || '#293745',
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

        {/* ── Branding ── */}
        <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <div className="flex items-center gap-3">
              <Palette size={18} className="text-gray-400" />
              <div>
                <h2 className="font-heading text-base font-semibold text-gray-900">Venue Branding</h2>
                <p className="text-xs text-gray-400 mt-0.5">Used on invoices, proposals, and all client-facing documents</p>
              </div>
            </div>
            <button
              onClick={saveBranding}
              disabled={brandSaving}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-all shadow-sm"
              style={{ backgroundColor: '#293745' }}
            >
              {brandSaving ? <Loader2 size={14} className="animate-spin" /> : brandSaved ? <CheckCircle2 size={14} /> : <Save size={14} />}
              {brandSaving ? 'Saving...' : brandSaved ? 'Saved!' : 'Save Branding'}
            </button>
          </div>

          <div className="px-6 py-6 space-y-6">

            {/* Logo Upload */}
            <div>
              <label className={LABEL}>Venue Logo</label>
              <p className="text-[11px] text-gray-400 mb-3">
                Your logo appears on all proposals, invoices, and client-facing documents. PNG, JPG, or SVG — max 5MB.
              </p>

              <div className="flex items-start gap-4">
                {/* Preview */}
                <div className="flex-shrink-0 h-24 w-40 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden relative">
                  {brand.brand_logo_url ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={brand.brand_logo_url}
                        alt="Logo preview"
                        className="h-full w-full object-contain p-2"
                        onError={e => (e.currentTarget.style.display = 'none')}
                      />
                      <button
                        type="button"
                        onClick={() => setBrand(p => ({ ...p, brand_logo_url: '' }))}
                        className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white opacity-80 hover:opacity-100 transition-opacity"
                      >
                        <X size={10} />
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-gray-300">
                      <ImageIcon size={24} />
                      <span className="text-[10px]">No logo</span>
                    </div>
                  )}
                </div>

                {/* Upload controls */}
                <div className="flex-1 space-y-2.5">
                  <input
                    ref={logoFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                  <button
                    type="button"
                    onClick={() => logoFileRef.current?.click()}
                    disabled={logoUploading}
                    className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-50 shadow-sm"
                  >
                    {logoUploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                    {logoUploading ? 'Uploading...' : brand.brand_logo_url ? 'Replace Logo' : 'Upload Logo'}
                  </button>

                  {/* URL fallback */}
                  <div>
                    <p className="text-[11px] text-gray-400 mb-1">Or paste a URL directly:</p>
                    <input
                      type="url"
                      value={brand.brand_logo_url}
                      onChange={upd('brand_logo_url')}
                      placeholder="https://yourvenue.com/logo.png"
                      className={INPUT}
                    />
                  </div>

                  {logoError && (
                    <p className="text-xs text-red-500">{logoError}</p>
                  )}
                  {logoUploading && (
                    <p className="text-xs text-gray-400">Uploading and saving your logo...</p>
                  )}
                </div>
              </div>
            </div>

            <hr className="border-gray-100" />

            {/* Contact info */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-4">Contact Information <span className="text-xs font-normal text-gray-400 ml-1">— shown on invoices and proposals</span></p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>Contact Email</label>
                  <input type="email" value={brand.brand_email} onChange={upd('brand_email')}
                    placeholder="hello@yourvenue.com" className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>Contact Phone</label>
                  <input type="tel" value={brand.brand_phone} onChange={upd('brand_phone')}
                    placeholder="(555) 000-0000" className={INPUT} />
                </div>
                <div className="sm:col-span-2">
                  <label className={LABEL}>Website</label>
                  <input type="url" value={brand.brand_website} onChange={upd('brand_website')}
                    placeholder="https://yourvenue.com" className={INPUT} />
                </div>
              </div>
            </div>

            {/* Address */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-4">Venue Address</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={LABEL}>Street Address</label>
                  <input type="text" value={brand.brand_address} onChange={upd('brand_address')}
                    placeholder="123 Wedding Lane" className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>City</label>
                  <input type="text" value={brand.brand_city} onChange={upd('brand_city')}
                    placeholder="Columbus" className={INPUT} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>State</label>
                    <input type="text" value={brand.brand_state} onChange={upd('brand_state')}
                      placeholder="OH" maxLength={2} className={INPUT} />
                  </div>
                  <div>
                    <label className={LABEL}>ZIP</label>
                    <input type="text" value={brand.brand_zip} onChange={upd('brand_zip')}
                      placeholder="43215" className={INPUT} />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer note */}
            <div>
              <label className={LABEL}>Invoice / Document Footer Note</label>
              <textarea value={brand.brand_footer_note} onChange={upd('brand_footer_note')}
                placeholder="Thank you for choosing our venue. All payments are non-refundable unless otherwise stated."
                rows={2}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:bg-white transition-colors resize-none"
              />
              <p className="text-[11px] text-gray-400 mt-1">Appears at the bottom of invoices and proposals.</p>
            </div>

            {/* Live preview */}
            {(brand.brand_logo_url || brand.brand_tagline || brand.brand_email) && (
              <div>
                <label className={LABEL}>Document Header Preview</label>
                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-6 py-5 flex items-center justify-between" style={{ backgroundColor: brand.brand_color || '#293745' }}>
                    <div className="flex items-center gap-4">
                      {brand.brand_logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={brand.brand_logo_url} alt="Logo" className="h-10 object-contain" onError={e => (e.currentTarget.style.display = 'none')} />
                      ) : (
                        <div className="h-10 w-10 rounded-lg bg-white/20 flex items-center justify-center text-white font-bold text-lg">
                          {venue?.name?.charAt(0) || 'V'}
                        </div>
                      )}
                      <div>
                        <p className="text-white font-semibold text-sm">{venue?.name || 'Your Venue'}</p>
                        {brand.brand_tagline && <p className="text-white/70 text-xs mt-0.5">{brand.brand_tagline}</p>}
                      </div>
                    </div>
                    <div className="text-right text-white/70 text-xs space-y-0.5">
                      {brand.brand_email && <p>{brand.brand_email}</p>}
                      {brand.brand_phone && <p>{brand.brand_phone}</p>}
                      {brand.brand_website && <p>{brand.brand_website}</p>}
                    </div>
                  </div>
                  {brand.brand_footer_note && (
                    <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
                      <p className="text-xs text-gray-400">{brand.brand_footer_note}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

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
