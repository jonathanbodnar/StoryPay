'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { postAuthNavigate } from '@/lib/platform';
import {
 LinkIcon,
 Check,
 CheckCircle2,
 MessageSquare,
 Loader2,
 Users,
 Download,
 AlertCircle,
 Copy,
 Webhook,
 RotateCcw,
 Sparkles,
 ShieldCheck,
 ShieldAlert,
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
 ghl_access_token: string | null; // masked '••••XXXX' or null on GET
 ghl_contacts_synced_at: string | null;
 a2p_verified?: boolean | null;
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
 const router = useRouter();
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

 // Inbound email diagnostic
 interface InboundEmailCheck { ok: boolean; label: string; detail: string }
 interface InboundEmailStatus {
   ready: boolean;
   webhookUrl: string;
   inboundDomain: string | null;
   checks: Record<string, InboundEmailCheck>;
   nextSteps: string[];
 }
 const [inboundEmail, setInboundEmail] = useState<InboundEmailStatus | null>(null);

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

 // Connection verification — runs the exact call the contact sync makes so a
 // bad key/sub-account pairing is caught at save time, not at sync time.
 const [verifying, setVerifying] = useState(false);
 const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string; totalContacts?: number | null } | null>(null);

 async function verifyGhlConnection() {
   setVerifying(true);
   setVerifyResult(null);
   try {
     const res = await fetch('/api/integrations/ghl/verify', { method: 'POST' });
     const d = await res.json() as { ok?: boolean; message?: string; totalContacts?: number | null };
     setVerifyResult({ ok: !!d.ok, message: d.message ?? (d.ok ? 'Connected.' : 'Connection test failed.'), totalContacts: d.totalContacts });
   } catch {
     setVerifyResult({ ok: false, message: 'Connection test failed — network error.' });
   } finally {
     setVerifying(false);
   }
 }

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
     // Immediately test the new key against the saved sub-account ID.
     void verifyGhlConnection();
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
     // Immediately test the pairing with the stored API key.
     void verifyGhlConnection();
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

 // Re-run the post-signup setup wizard (Google import → guide → publish).
 const [restarting, setRestarting] = useState(false);
 async function restartOnboarding() {
   setRestarting(true);
   try {
     await fetch('/api/onboarding/state', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ action: 'restart' }),
     });
    try { sessionStorage.removeItem('sv_onboarding_skipped'); } catch { /* ignore */ }
    // router.push on native / full reload on web — a top-level navigation to
    // /dashboard/* gets ejected to the system browser by the shipped binary.
    postAuthNavigate(router, '/dashboard/listing?onboarding=1');
  } catch {
    setRestarting(false);
  }
}

// Full start-over: wipe the imported guide/media/copy, unpublish, and re-run
// the wizard from a clean slate so they can pick a DIFFERENT Google listing
// (e.g. they imported the wrong venue). Production-safe and irreversible, so
// we confirm first.
const [startingOver, setStartingOver] = useState(false);
async function startOverOnboarding() {
  const ok = window.confirm(
    'Start over? This permanently removes your imported guide, photos, and copy, and unpublishes your page so you can re-import a different Google listing from scratch. This cannot be undone.',
  );
  if (!ok) return;
  setStartingOver(true);
  try {
    await fetch('/api/onboarding/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start_over' }),
    });
    try { sessionStorage.removeItem('sv_onboarding_skipped'); } catch { /* ignore */ }
    postAuthNavigate(router, '/dashboard/listing?onboarding=1');
  } catch {
    setStartingOver(false);
  }
}

// DEV-ONLY: wipe the guide + un-publish, then re-run the wizard from scratch.
// The button is only rendered outside production; the API also hard-guards it.
const isDev = process.env.NODE_ENV !== 'production';
const [devResetting, setDevResetting] = useState(false);
async function devResetOnboarding() {
  setDevResetting(true);
  try {
    await fetch('/api/onboarding/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dev_reset' }),
    });
    try { sessionStorage.removeItem('sv_onboarding_skipped'); } catch { /* ignore */ }
    postAuthNavigate(router, '/dashboard/listing?onboarding=1');
  } catch {
    setDevResetting(false);
  }
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

// Load inbound-email diagnostic status. This is best-effort — if the
// route doesn't exist on this deployment yet, just leave the panel
// hidden.
try {
  const ieRes = await fetch('/api/integrations/inbound-email/status', { cache: 'no-store' });
  if (ieRes.ok) {
    setInboundEmail(await ieRes.json());
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

 <div className="space-y-6">

 {/* Setup wizard — re-run the guided onboarding flow */}
 <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
 <Sparkles size={18} className="text-gray-400" />
 <h2 className="font-heading text-base font-semibold text-gray-900">Setup Wizard</h2>
 </div>
 <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
 <div className="min-w-0">
 <p className="text-sm font-medium text-gray-900">Re-run guided setup</p>
 <p className="mt-0.5 text-sm text-gray-500">Re-import from Google, redraft your guide, and republish. Your live page stays up until you republish.</p>
 </div>
 <button
 onClick={() => void restartOnboarding()}
 disabled={restarting}
 className="shrink-0 inline-flex items-center gap-1.5 rounded-2xl border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
 >
 {restarting ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
 {restarting ? 'Starting…' : 'Restart setup wizard'}
 </button>
 </div>
 <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 px-6 py-5">
 <div className="min-w-0">
 <p className="text-sm font-medium text-gray-900">Picked the wrong venue? Start over</p>
 <p className="mt-0.5 text-sm text-gray-500">Removes your imported guide, photos, and copy and unpublishes your page, so you can re-import a different Google listing from scratch. This can&apos;t be undone.</p>
 </div>
 <button
 onClick={() => void startOverOnboarding()}
 disabled={startingOver}
 className="shrink-0 inline-flex items-center gap-1.5 rounded-2xl border border-red-200 bg-white px-4 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
 >
 {startingOver ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
 {startingOver ? 'Starting over…' : 'Start over & re-import'}
 </button>
 </div>
 {isDev && (
 <div className="flex flex-wrap items-center justify-between gap-4 border-t border-dashed border-amber-200 bg-amber-50/40 px-6 py-4">
 <div className="min-w-0">
 <p className="text-sm font-medium text-amber-800">Reset &amp; start fresh (dev only)</p>
 <p className="mt-0.5 text-sm text-amber-700/80">Wipes this venue&apos;s pricing guide and un-publishes, then reopens the wizard so you can practice the whole flow from scratch. Disabled in production.</p>
 </div>
 <button
 onClick={() => void devResetOnboarding()}
 disabled={devResetting}
 className="shrink-0 inline-flex items-center gap-1.5 rounded-2xl border border-amber-300 bg-white px-4 py-2 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50 transition-colors"
 >
 {devResetting ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
 {devResetting ? 'Resetting…' : 'Reset onboarding (dev)'}
 </button>
 </div>
 )}
 </section>

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
placeholder={venue.ghl_location_id ? `${venue.ghl_location_id} (paste a new one to replace)` : 'Paste your sub-account ID here'}
className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none font-mono"
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

{/* Connection test — runs the exact API call the contact sync uses */}
<div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
  <div className="flex items-center justify-between gap-4">
    <div>
      <p className="text-xs font-medium text-gray-700">Connection Test</p>
      <p className="mt-0.5 text-[11px] text-gray-500">Confirms your API key and sub-account ID work together before syncing.</p>
    </div>
    <button
      onClick={() => void verifyGhlConnection()}
      disabled={verifying}
      className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
    >
      {verifying ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
      {verifying ? 'Testing…' : 'Test connection'}
    </button>
  </div>
  {verifyResult && (
    <div className={`mt-3 rounded-xl border px-3.5 py-2.5 text-xs flex items-start gap-2 ${verifyResult.ok ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-red-100 bg-red-50 text-red-700'}`}>
      {verifyResult.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <AlertCircle size={13} className="mt-0.5 shrink-0" />}
      <span>
        {verifyResult.message}
        {verifyResult.ok && typeof verifyResult.totalContacts === 'number' && (
          <> Found <strong>{verifyResult.totalContacts.toLocaleString()}</strong> contacts ready to sync.</>
        )}
      </span>
    </div>
  )}
</div>

{/* A2P carrier registration status — mirrors the GHL sub-account. Carrier
    compliance lives on their messaging sub-account, so connected = verified. */}
{(() => {
  const a2pActive = venue.a2p_verified === true || venue.ghl_connected || Boolean(venue.ghl_location_id);
  return (
    <div className={`rounded-2xl border p-4 ${a2pActive ? 'border-emerald-100 bg-emerald-50/60' : 'border-amber-100 bg-amber-50/60'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${a2pActive ? 'bg-white border-emerald-200' : 'bg-white border-amber-200'}`}>
            {a2pActive
              ? <ShieldCheck size={16} className="text-emerald-600" />
              : <ShieldAlert size={16} className="text-amber-600" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">A2P Carrier Registration</p>
            <p className="mt-0.5 text-[11px] text-gray-500">
              {a2pActive
                ? 'Verified and active through your connected messaging sub-account. SMS features (14-day sequence texts, AI Concierge, two-way messaging) are cleared to send.'
                : 'Not active yet. A2P registration is required by US carriers before any SMS can be sent. It activates automatically when your messaging sub-account is connected above.'}
            </p>
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${a2pActive ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {a2pActive ? <><ShieldCheck size={13} /> Verified &amp; active</> : <><ShieldAlert size={13} /> Not registered</>}
        </span>
      </div>
    </div>
  );
})()}

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
            <p className="mt-0.5 text-[11px] text-gray-500">Pulls all contacts from your StoryVenue Legacy sub-account in one go.</p>
            {venue.ghl_contacts_synced_at && !isRunning && (
              <p className="mt-1 text-[11px] text-gray-400">
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
          {isRunning ? 'Syncing…' : 'Sync All Contacts'}
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

      {/* Partial banner */}
      {syncProgress?.status === 'partial' && !isRunning && (
        <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          <span className="font-semibold">Partially synced.</span> Pulled {(syncProgress.fetched ?? 0).toLocaleString()} of {total?.toLocaleString() ?? 'many'} contacts. Click <strong>Sync All Contacts</strong> again to continue.
        </div>
      )}

      {/* Failed banner */}
      {syncProgress?.status === 'failed' && (() => {
        const rawErr = syncProgress.error || '';
        const isCredentialError = /401|api key is invalid|credentials have expired|reconnect/i.test(rawErr);
        const friendlyMsg = isCredentialError
          ? 'Your GHL API key has expired or been revoked. Go to Settings → Messaging and reconnect your GHL account to fix this.'
          : rawErr || 'Contact sync failed.';
        return (
          <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 flex items-start gap-2">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{friendlyMsg}</span>
          </div>
        );
      })()}

      {syncError && (() => {
        const isCredentialError = /401|api key is invalid|credentials have expired|reconnect/i.test(syncError);
        const friendlyMsg = isCredentialError
          ? 'Your GHL API key has expired or been revoked. Go to Settings → Messaging and reconnect your GHL account to fix this.'
          : syncError;
        return (
          <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 flex items-start gap-2">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{friendlyMsg}</span>
          </div>
        );
      })()}
    </div>
  );
})()}

 </div>
 </section>
 </div>
 </div>
 );
}
