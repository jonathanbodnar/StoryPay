'use client';

import { useEffect, useState } from 'react';
import LunarPayOnboarding from '@/components/settings/LunarPayOnboarding';
import { useRef } from 'react';
import {
 LinkIcon,
 CheckCircle2,
 Check,
 CreditCard,
 MessageSquare,
 Loader2,
 ExternalLink,
 Rocket,
 RotateCcw,
 Users,
 Download,
 AlertCircle,
 Landmark,
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
 ghl_contacts_synced_at: string | null;
 legacy_location_id?: string | null;
 lunarpay_merchant_id: number | null;
 service_fee_rate: number;
 accept_ach: boolean | null;
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


export default function SettingsPage() {
 const [venue, setVenue] = useState<VenueInfo | null>(null);
 const [loading, setLoading] = useState(true);
 const [isOwner, setIsOwner] = useState(true); // default true until session loads
 const [feeSaving, setFeeSaving] = useState(false);
 const [feeSaved, setFeeSaved] = useState(false);
 const [feeInput, setFeeInput] = useState('2.75');
 const [achSaving, setAchSaving] = useState(false);
 const [achSaved, setAchSaved] = useState(false);
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

 // Onboarding state — only need reset here, checklist lives on dashboard
 const [resetting, setResetting] = useState(false);

 // GHL contact sync
 const [syncingContacts, setSyncingContacts] = useState(false);
 const [syncResult, setSyncResult] = useState<{ created: number; updated: number; linked: number; fetched: number } | null>(null);
 const [syncError, setSyncError] = useState('');

 // StoryVenue Legacy (GHL) location ID — manual entry
 const [locationIdInput, setLocationIdInput] = useState('');
 const [savingLocationId, setSavingLocationId] = useState(false);
 const [locationIdSaved, setLocationIdSaved] = useState(false);
 const [locationIdError, setLocationIdError] = useState('');

 async function saveLocationId() {
   const val = locationIdInput.trim();
   if (!val) return;
   setSavingLocationId(true);
   setLocationIdError('');
   setLocationIdSaved(false);
   try {
     const res = await fetch('/api/venues/me', {
       method: 'PATCH',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ ghl_location_id: val, ghl_connected: true }),
     });
     if (!res.ok) { setLocationIdError('Failed to save. Please try again.'); return; }
     const updated = await res.json();
     setVenue(prev => prev ? { ...prev, ghl_location_id: updated.ghl_location_id, ghl_connected: true } : prev);
     setLocationIdSaved(true);
     setLocationIdInput('');
     setTimeout(() => setLocationIdSaved(false), 3000);
   } catch { setLocationIdError('Failed to save. Please try again.'); }
   finally { setSavingLocationId(false); }
 }

 async function syncGhlContacts() {
   setSyncingContacts(true);
   setSyncError('');
   setSyncResult(null);
   try {
     const res = await fetch('/api/integrations/ghl/sync-contacts', { method: 'POST' });
     const data = await res.json();
     if (!res.ok || !data.ok) {
       setSyncError(data.error || 'Contact sync failed');
       return;
     }
     setSyncResult(data.counts);
     // Refresh venue payload so the "last synced" timestamp updates inline.
     const venueRes = await fetch('/api/venues/me', { cache: 'no-store' });
     if (venueRes.ok) setVenue(await venueRes.json());
   } catch {
     setSyncError('Contact sync failed. Please try again.');
   } finally {
     setSyncingContacts(false);
   }
 }

 async function resetOnboarding() {
 setResetting(true);
 try {
 // Clear localStorage keys for this venue — the checklist component listens for this event
 const venueRes = await fetch('/api/venues/me', { cache: 'no-store' });
 if (venueRes.ok) {
 const v = await venueRes.json();
 try {
 localStorage.removeItem(`onboarding_steps_${v.id}`);
 localStorage.removeItem(`onboarding_dismissed_${v.id}`);
 } catch { /* storage unavailable */ }
 window.dispatchEvent(new Event('onboarding:reset'));
 }
 // Also reset DB flags (best-effort)
 await fetch('/api/onboarding', {
 method: 'POST', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'reset' }),
 });
 } finally { setResetting(false); }
 }

 async function loadVenue() {
 try {
 const res = await fetch('/api/venues/me', { cache: 'no-store' });
 if (res.ok) {
 const data = await res.json();
 setVenue(data);
 setFeeInput(String(data.service_fee_rate ?? 2.75));
 if (data.ghl_location_id) setLocationIdInput(data.ghl_location_id);
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
 const sessionRes = await fetch('/api/session/me', { cache: 'no-store' });
 if (sessionRes.ok) {
 const session = await sessionRes.json();
 setIsOwner(session.isOwner ?? true);
 }
 } finally {
 setLoading(false);
 }
 }

 useEffect(() => { void loadVenue(); }, []);

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
 <Loader2 className="animate-spin text-gray-400"size={24} />
 </div>
 );
 }

 if (!venue) {
 return (
 <div className="py-20 text-center">
 <p className="text-gray-500 mb-4">Unable to load venue settings.</p>
 <button
 onClick={() => { setLoading(true); window.location.reload(); }}
 className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
 >
 Retry
 </button>
 </div>
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

 const toggleAcceptAch = async (next: boolean) => {
 setAchSaving(true);
 try {
 const res = await fetch('/api/venues/me', {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ accept_ach: next }),
 });
 if (res.ok) {
 setVenue((prev) => prev ? { ...prev, accept_ach: next } : prev);
 setAchSaved(true);
 setTimeout(() => setAchSaved(false), 2500);
 }
 } finally {
 setAchSaving(false);
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
 <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
 <CreditCard size={18} className="text-gray-400"/>
 <h2 className="font-heading text-base font-semibold text-gray-900">Payment Processing</h2>
 </div>
 <div className="px-6 py-6">
 <LunarPayOnboarding onActivated={() => void loadVenue()} />
 </div>
 </section>

 {/* Customer Payment Methods (ACH / eCheck toggle) */}
 {isActive && (
 <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
 <Landmark size={18} className="text-gray-400" />
 <h2 className="font-heading text-base font-semibold text-gray-900">Customer Payment Methods</h2>
 </div>
 <div className="px-6 py-6 space-y-5">
 {/* Card (always on) */}
 <div className="flex items-start justify-between gap-4">
 <div className="flex items-start gap-3">
 <CreditCard size={18} className="mt-0.5 text-gray-400" />
 <div>
 <p className="text-sm font-medium text-gray-900">Credit & Debit Cards</p>
 <p className="mt-0.5 text-xs text-gray-500">Always enabled. Funds settle to your account in 1–2 business days.</p>
 </div>
 </div>
 <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
 <CheckCircle2 size={12} /> Always on
 </span>
 </div>

 {/* ACH toggle */}
 <div className="flex items-start justify-between gap-4 border-t border-gray-100 pt-5">
 <div className="flex items-start gap-3">
 <Landmark size={18} className="mt-0.5 text-gray-400" />
 <div>
 <p className="text-sm font-medium text-gray-900">ACH / Bank Transfer (eCheck)</p>
 <p className="mt-0.5 text-xs text-gray-500">
 Customers pay directly from a bank account using their routing & account numbers. Funds settle in 3–5 business days. No card processing fees from the customer&apos;s side.
 </p>
 <p className="mt-1 text-[11px] text-gray-400">
 Note: ACH only appears at checkout if your LunarPay/Fortis merchant account also has ACH enabled. If you need it activated, contact LunarPay support.
 </p>
 </div>
 </div>
 <button
 type="button"
 disabled={achSaving}
 onClick={() => toggleAcceptAch(venue.accept_ach === false ? true : false)}
 className={[
 'shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50',
 venue.accept_ach !== false ? 'bg-emerald-500' : 'bg-gray-200',
 ].join(' ')}
 aria-label="Toggle ACH"
 >
 <span
 className={[
 'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
 venue.accept_ach !== false ? 'translate-x-6' : 'translate-x-1',
 ].join(' ')}
 />
 </button>
 </div>

 {achSaved && (
 <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
 <Check size={12} /> Saved
 </div>
 )}
 </div>
 </section>
 )}

 {/* ── Setup Guide (owners only, desktop only) ── */}
 {isOwner && <section className="hidden md:block rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="flex items-center justify-between gap-4 px-6 py-5">
 <div className="flex items-center gap-3">
 <Rocket size={18} className="text-gray-400"/>
 <div>
 <h2 className="font-heading text-base font-semibold text-gray-900">Setup Guide</h2>
 <p className="text-xs text-gray-400 mt-0.5">Reactivate the Getting Started guide on your dashboard.</p>
 </div>
 </div>
 <button
 onClick={resetOnboarding}
 disabled={resetting}
 className="flex items-center gap-1.5 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
 >
 {resetting ? <Loader2 size={14} className="animate-spin"/> : <RotateCcw size={14} />}
 Restart Setup Guide
 </button>
 </div>
 </section>}

 {/* StoryVenue Legacy (Messaging) Integration */}
 <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
 <MessageSquare size={18} className="text-gray-400"/>
 <h2 className="font-heading text-base font-semibold text-gray-900">StoryVenue Legacy</h2>
 </div>
 <div className="px-6 py-5 space-y-5">

 {/* Status row */}
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-gray-900">
 {venue.ghl_connected || venue.ghl_location_id ? 'Connected' : 'Not Connected'}
 </p>
 <p className="mt-0.5 text-sm text-gray-500">
 {venue.ghl_connected || venue.ghl_location_id
 ? 'SMS messaging is active.'
 : 'Enter your StoryVenue Legacy sub-account ID below to enable SMS.'}
 </p>
 </div>
 <span className={`shrink-0 ml-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${venue.ghl_connected || venue.ghl_location_id ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
 {venue.ghl_connected || venue.ghl_location_id ? <><CheckCircle2 size={14} /> Connected</> : 'Not connected'}
 </span>
 </div>

 {/* Sub-account ID field — always visible so it can be edited */}
 <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
 <p className="text-xs font-medium text-gray-700 mb-2">Sub-Account ID</p>
 <div className="flex gap-2">
 <input
 type="text"
 value={locationIdInput}
 onChange={e => setLocationIdInput(e.target.value)}
 placeholder="Paste your sub-account ID here"
 className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
 />
 <button
 onClick={() => void saveLocationId()}
 disabled={savingLocationId || !locationIdInput.trim()}
 className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
 >
 {savingLocationId ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
 {savingLocationId ? 'Saving…' : 'Save'}
 </button>
 </div>
 {locationIdSaved && <p className="mt-2 text-xs text-emerald-600">Saved successfully.</p>}
 {locationIdError && <p className="mt-2 text-xs text-red-600">{locationIdError}</p>}
 </div>

 {/* Contact sync — only show when connected */}
 {(venue.ghl_connected || venue.ghl_location_id) && (
 <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
 <div className="flex items-start justify-between gap-4 flex-wrap">
 <div className="flex items-start gap-3 min-w-0 flex-1">
 <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white border border-gray-200">
 <Users size={16} className="text-gray-500" />
 </div>
 <div className="min-w-0">
 <p className="text-sm font-medium text-gray-900">Contact Sync</p>
 {venue.ghl_contacts_synced_at && (
 <p className="mt-1.5 text-[11px] text-gray-400">
 Last synced{' '}
 {new Date(venue.ghl_contacts_synced_at).toLocaleString(undefined, {
 dateStyle: 'medium', timeStyle: 'short',
 })}
 </p>
 )}
 </div>
 </div>
 <button
 onClick={() => void syncGhlContacts()}
 disabled={syncingContacts}
 className="shrink-0 inline-flex items-center gap-1.5 rounded-2xl border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
 >
 {syncingContacts ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
 {syncingContacts ? 'Syncing…' : 'Sync from StoryVenue Legacy'}
 </button>
 </div>
 {syncResult && (
 <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
 <span className="font-semibold">Done.</span> Pulled {syncResult.fetched} contact{syncResult.fetched === 1 ? '' : 's'} —{' '}
 {syncResult.created} new, {syncResult.linked} matched by email, {syncResult.updated} updated.
 </div>
 )}
 {syncError && (
 <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 flex items-start gap-2">
 <AlertCircle size={13} className="mt-0.5 shrink-0" />
 <span>{syncError}</span>
 </div>
 )}
 </div>
 )}
 </div>
 </section>
 </div>
 </div>
 );
}
