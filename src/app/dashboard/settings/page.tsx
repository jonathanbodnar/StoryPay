'use client';

import { useEffect, useState, useRef } from 'react';
import {
 LinkIcon,
 Check,
 CheckCircle2,
 CreditCard,
 MessageSquare,
 Loader2,
 ExternalLink,
 Rocket,
 RotateCcw,
 Users,
 Download,
 AlertCircle,
} from 'lucide-react';
import InstallAppCard from '@/components/InstallAppCard';

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
 ghl_access_token: string | null; // masked '••••XXXX' or null on GET
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
 interface SyncProgress {
   status: 'running' | 'completed' | 'partial' | 'failed';
   started_at?: string;
   completed_at?: string;
   fetched?: number;
   total?: number | null;
   created?: number;
   updated?: number;
   linked?: number;
   errors?: number;
   error?: string;
   page?: number;
 }
 const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
 const [syncStarting, setSyncStarting] = useState(false);
 const [syncError, setSyncError] = useState('');
 const syncPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

 function stopSyncPolling() {
   if (syncPollTimer.current) {
     clearInterval(syncPollTimer.current);
     syncPollTimer.current = null;
   }
 }

 async function pollSyncStatus() {
   try {
     const res = await fetch('/api/integrations/ghl/sync-contacts', { cache: 'no-store' });
     if (!res.ok) return;
     const data = await res.json();
     const p = data.progress as SyncProgress | null;
     if (p) {
       setSyncProgress(p);
       if (p.status === 'completed' || p.status === 'partial' || p.status === 'failed') {
         stopSyncPolling();
         // Refresh venue so last_synced_at updates inline
         try {
           const vRes = await fetch('/api/venues/me', { cache: 'no-store' });
           if (vRes.ok) setVenue(await vRes.json());
         } catch { /* ignore */ }
       }
     }
   } catch { /* ignore transient errors during poll */ }
 }

 // StoryVenue Legacy (GHL) location ID — manual entry
 const [locationIdInput, setLocationIdInput] = useState('');
 const [savingLocationId, setSavingLocationId] = useState(false);
 const [locationIdSaved, setLocationIdSaved] = useState(false);
 const [locationIdError, setLocationIdError] = useState('');

 // StoryVenue Legacy API Key (v1 location key) — entered once per sub-account
 const [apiKeyInput, setApiKeyInput] = useState('');
 const [savingApiKey, setSavingApiKey] = useState(false);
 const [apiKeySaved, setApiKeySaved] = useState(false);
 const [apiKeyError, setApiKeyError] = useState('');
 const [showApiKeyHelp, setShowApiKeyHelp] = useState(false);

 async function saveApiKey() {
   const val = apiKeyInput.trim();
   if (!val) return;
   setSavingApiKey(true);
   setApiKeyError('');
   setApiKeySaved(false);
   try {
     const res = await fetch('/api/venues/me', {
       method: 'PATCH',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ ghl_access_token: val, ghl_connected: true }),
     });
     if (!res.ok) { setApiKeyError('Failed to save. Please try again.'); return; }
     setVenue(prev => prev ? { ...prev, ghl_access_token: `••••${val.slice(-4)}`, ghl_connected: true } : prev);
     setApiKeySaved(true);
     setApiKeyInput('');
     setTimeout(() => setApiKeySaved(false), 3000);
   } catch { setApiKeyError('Failed to save. Please try again.'); }
   finally { setSavingApiKey(false); }
 }

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
   stopSyncPolling();
   setSyncStarting(true);
   setSyncError('');
   setSyncProgress({ status: 'running', fetched: 0, total: null, page: 0 });
   try {
     const res = await fetch('/api/integrations/ghl/sync-contacts', { method: 'POST' });
     const data = await res.json();
     if (!res.ok || !data.ok) {
       setSyncError(data.error || 'Contact sync failed');
       setSyncProgress(null);
       return;
     }
     // Start polling for progress every 2s
     syncPollTimer.current = setInterval(() => { void pollSyncStatus(); }, 2000);
     void pollSyncStatus();
   } catch {
     setSyncError('Contact sync failed. Please try again.');
     setSyncProgress(null);
   } finally {
     setSyncStarting(false);
   }
 }

 useEffect(() => {
   return () => stopSyncPolling();
 }, []);

 async function resetOnboarding() {
 setResetting(true);
 try {
   await fetch('/api/onboarding', {
     method: 'POST', headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ action: 'reset' }),
   });
   window.dispatchEvent(new Event('onboarding:reset'));
 } finally { setResetting(false); }
 }

 async function loadVenue() {
 try {
 const res = await fetch('/api/venues/me', { cache: 'no-store' });
 if (res.ok) {
 const data = await res.json();
 setVenue(data);
 if (data.ghl_location_id) setLocationIdInput(data.ghl_location_id);

 // Restore sync state if a sync is in flight (e.g. user refreshed the
 // page while a previous sync was still running on the server).
 try {
   const sRes = await fetch('/api/integrations/ghl/sync-contacts', { cache: 'no-store' });
   if (sRes.ok) {
     const sData = await sRes.json();
     const p = sData.progress as SyncProgress | null;
     if (p) {
       setSyncProgress(p);
       if (p.status === 'running') {
         syncPollTimer.current = setInterval(() => { void pollSyncStatus(); }, 2000);
       }
     }
   }
 } catch { /* non-fatal */ }

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


 return (
 <div>
 <div className="mb-8">
 <h1 className="font-heading text-2xl font-semibold text-gray-900">Settings</h1>
 <p className="mt-1 text-sm text-gray-500">Manage your venue configuration and integrations</p>
 </div>

 {/* Install app — always shown so owners always know it's an option */}
 <div className="mb-6">
   <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">App</p>
   <InstallAppCard variant="card" />
 </div>

 <div className="space-y-6">

 {/* Payment settings moved notice */}
 <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
 <div className="flex items-start sm:items-center gap-3 min-w-0">
 <CreditCard size={18} className="text-gray-400 shrink-0 mt-0.5 sm:mt-0" />
 <div className="min-w-0">
 <p className="text-sm font-medium text-gray-900">Payment Processing &amp; Customer Payment Methods</p>
 <p className="mt-0.5 text-xs text-gray-500">Configure your merchant account and ACH/card options under Payments → Settings.</p>
 </div>
 </div>
 <a href="/dashboard/payments/settings"
 className="shrink-0 self-start sm:self-auto inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap">
 Go to Payment Settings <ExternalLink size={12} />
 </a>
 </div>

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

{/* Legacy API Key — required for contact sync + SMS */}
<div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
  <div className="flex items-center justify-between mb-2">
    <p className="text-xs font-medium text-gray-700">API Key</p>
    <button
      type="button"
      onClick={() => setShowApiKeyHelp(s => !s)}
      className="text-xs text-gray-500 hover:text-gray-900 underline decoration-dotted underline-offset-2"
    >
      {showApiKeyHelp ? 'Hide' : 'Where do I find this?'}
    </button>
  </div>
  {showApiKeyHelp && (
    <div className="mb-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-xs text-gray-600 space-y-1">
      <p className="font-medium text-gray-900">Grab the API key from your StoryVenue Legacy sub-account:</p>
      <ol className="list-decimal pl-4 space-y-0.5">
        <li>Log into your StoryVenue Legacy sub-account.</li>
        <li>Open <strong>Settings → Business Profile</strong> (scroll to the bottom) — or <strong>Settings → API Key</strong> in the newer UI.</li>
        <li>Copy the <strong>API Key</strong> value and paste it below.</li>
      </ol>
      <p className="text-[11px] text-gray-400 pt-1">Stored encrypted. Only the last 4 characters are ever shown again.</p>
    </div>
  )}
  <div className="flex gap-2">
    <input
      type="password"
      value={apiKeyInput}
      onChange={e => setApiKeyInput(e.target.value)}
      placeholder={venue.ghl_access_token ? `${venue.ghl_access_token} (paste a new one to replace)` : 'Paste your Legacy API Key here'}
      className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none font-mono"
    />
    <button
      onClick={() => void saveApiKey()}
      disabled={savingApiKey || !apiKeyInput.trim()}
      className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
    >
      {savingApiKey ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
      {savingApiKey ? 'Saving…' : 'Save'}
    </button>
  </div>
  {apiKeySaved && <p className="mt-2 text-xs text-emerald-600">Saved successfully.</p>}
  {apiKeyError && <p className="mt-2 text-xs text-red-600">{apiKeyError}</p>}
</div>

{/* Contact sync — only show when connected */}
{(venue.ghl_connected || venue.ghl_location_id) && (() => {
  const isRunning = syncProgress?.status === 'running' || syncStarting;
  const fetched = syncProgress?.fetched ?? 0;
  const total = syncProgress?.total ?? null;
  const pct = total && total > 0 ? Math.min(100, Math.round((fetched / total) * 100)) : null;
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white border border-gray-200">
            <Users size={16} className="text-gray-500" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">Contact Sync</p>
            {venue.ghl_contacts_synced_at && !isRunning && (
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
          disabled={isRunning}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-2xl border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {isRunning ? 'Syncing…' : 'Sync from StoryVenue Legacy'}
        </button>
      </div>

      {/* Progress bar */}
      {isRunning && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5 text-[11px] text-gray-500">
            <span>
              {total !== null
                ? <>Pulled <span className="font-semibold text-gray-700">{fetched.toLocaleString()}</span> of <span className="font-semibold text-gray-700">{total.toLocaleString()}</span> contacts</>
                : fetched > 0
                  ? <>Pulled <span className="font-semibold text-gray-700">{fetched.toLocaleString()}</span> contacts so far…</>
                  : 'Connecting to StoryVenue Legacy…'}
            </span>
            {pct !== null && <span className="font-semibold text-gray-700">{pct}%</span>}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full bg-emerald-500 transition-all duration-500 ease-out"
              style={{ width: pct !== null ? `${pct}%` : '40%' }}
            />
          </div>
        </div>
      )}

      {/* Completed banner */}
      {syncProgress?.status === 'completed' && !isRunning && (
        <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
          <span className="font-semibold">Done.</span> Pulled {(syncProgress.fetched ?? 0).toLocaleString()} contact{syncProgress.fetched === 1 ? '' : 's'} —{' '}
          {syncProgress.created ?? 0} new, {syncProgress.linked ?? 0} matched by email, {syncProgress.updated ?? 0} updated{(syncProgress.errors ?? 0) > 0 ? `, ${syncProgress.errors} errors` : ''}.
        </div>
      )}

      {/* Partial banner — wall-clock hit; cron will catch the rest */}
      {syncProgress?.status === 'partial' && !isRunning && (
        <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          <span className="font-semibold">Partial sync.</span> Pulled {(syncProgress.fetched ?? 0).toLocaleString()} of {total?.toLocaleString() ?? 'many'} contacts. The hourly sync will catch the rest — or click Sync again now.
        </div>
      )}

      {/* Failed banner */}
      {syncProgress?.status === 'failed' && (
        <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 flex items-start gap-2">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{syncProgress.error || 'Contact sync failed.'}</span>
        </div>
      )}

      {syncError && (
        <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 flex items-start gap-2">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{syncError}</span>
        </div>
      )}
    </div>
  );
})()}
 </div>
 </section>
 </div>
 </div>
 );
}
