'use client';

import { useEffect, useState, useCallback } from 'react';
import {
 Loader2, CheckCircle2, XCircle, Link2, Unlink, RefreshCw,
 ArrowRight, Clock, AlertCircle, ExternalLink, Calendar,
} from 'lucide-react';

interface Integration {
 id: string;
 provider: 'quickbooks' | 'freshbooks';
 company_name: string | null;
 connected_at: string;
 last_synced_at: string | null;
 sync_enabled: boolean;
}

interface SyncLogEntry {
 id: string;
 provider: string;
 proposal_id: string | null;
 external_id: string | null;
 status: string;
 error_message: string | null;
 synced_at: string;
}

interface StatusData {
 integrations: Integration[];
 recentSyncs: SyncLogEntry[];
 available: { quickbooks: boolean; freshbooks: boolean };
}

interface CalendlyStatus {
 connected: boolean;
 user_name?: string;
 user_email?: string;
 webhook_registered?: boolean;
 error?: string;
}

const PROVIDERS = {
 quickbooks: {
 name: 'QuickBooks Online',
 shortName: 'QuickBooks',
 description: 'Sync your StoryPay transactions as sales receipts in QuickBooks Online.',
 color: '#2CA01C',
 logo: '📗',
 setupUrl: 'https://developer.intuit.com/app/developer/qbo/docs/get-started',
 },
 freshbooks: {
 name: 'FreshBooks',
 shortName: 'FreshBooks',
 description: 'Sync your StoryPay transactions as invoices in FreshBooks.',
 color: '#0075DD',
 logo: '📘',
 setupUrl: 'https://www.freshbooks.com/api/start',
 },
} as const;

function timeAgo(iso: string) {
 const diff = Date.now() - new Date(iso).getTime();
 const mins = Math.floor(diff / 60000);
 if (mins < 1) return 'Just now';
 if (mins < 60) return `${mins}m ago`;
 const hrs = Math.floor(mins / 60);
 if (hrs < 24) return `${hrs}h ago`;
 const days = Math.floor(hrs / 24);
 return `${days}d ago`;
}

export default function IntegrationsPage() {
 const [data, setData] = useState<StatusData | null>(null);
 const [loading, setLoading] = useState(true);
 const [connecting, setConnecting] = useState<string | null>(null);
 const [disconnecting, setDisconnecting] = useState<string | null>(null);
 const [syncing, setSyncing] = useState<string | null>(null);
 const [syncResult, setSyncResult] = useState<{ provider: string; message: string; type: 'success' | 'error' } | null>(null);

 // Calendly state
 const [calendly, setCalendly] = useState<CalendlyStatus | null>(null);
 const [calendlyToken, setCalendlyToken] = useState('');
 const [showCalendlyInput, setShowCalendlyInput] = useState(false);
 const [calendlyConnecting, setCalendlyConnecting] = useState(false);
 const [calendlyDisconnecting, setCalendlyDisconnecting] = useState(false);
 const [calendlySyncing, setCalendlySyncing] = useState(false);

 // iCal state
 const [icalUrl, setIcalUrl] = useState('');
 const [availabilityUrl, setAvailabilityUrl] = useState('');
 const [icalCopied, setIcalCopied] = useState<string | null>(null);

 const fetchStatus = useCallback(async () => {
 try {
 const [intRes, calRes, venueRes] = await Promise.all([
   fetch('/api/integrations/status'),
   fetch('/api/integrations/calendly/status'),
   fetch('/api/venues/me'),
 ]);
 if (intRes.ok) setData(await intRes.json());
 if (calRes.ok) setCalendly(await calRes.json());
 if (venueRes.ok) {
   const venue = await venueRes.json();
   const base = window.location.origin;
   setIcalUrl(`${base}/api/calendar/ical?token=${venue.id}`);
   setAvailabilityUrl(`${base}/availability/${venue.id}`);
 }
 } finally { setLoading(false); }
 }, []);

 useEffect(() => { fetchStatus(); }, [fetchStatus]);

 useEffect(() => {
 const params = new URLSearchParams(window.location.search);
 const connected = params.get('connected');
 const error = params.get('error');
 if (connected) {
 setSyncResult({ provider: connected, message: `${PROVIDERS[connected as keyof typeof PROVIDERS]?.name || connected} connected successfully!`, type: 'success' });
 window.history.replaceState({}, '', window.location.pathname);
 fetchStatus();
 }
 if (error) {
 setSyncResult({ provider: '', message: `Connection failed: ${error}`, type: 'error' });
 window.history.replaceState({}, '', window.location.pathname);
 }
 }, [fetchStatus]);

 async function connect(provider: string) {
 setConnecting(provider);
 try {
 const res = await fetch('/api/integrations/connect', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ provider }),
 });
 const { url, error } = await res.json();
 if (url) {
 window.location.href = url;
 } else {
 setSyncResult({ provider, message: error || 'Failed to start connection', type: 'error' });
 setConnecting(null);
 }
 } catch {
 setSyncResult({ provider, message: 'Network error', type: 'error' });
 setConnecting(null);
 }
 }

 async function disconnect(provider: string) {
 if (!confirm(`Disconnect ${PROVIDERS[provider as keyof typeof PROVIDERS]?.name}? You can reconnect anytime.`)) return;
 setDisconnecting(provider);
 try {
 await fetch('/api/integrations/disconnect', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ provider }),
 });
 fetchStatus();
 } finally { setDisconnecting(null); }
 }

 async function syncNow(provider: string) {
 setSyncing(provider);
 setSyncResult(null);
 try {
 const res = await fetch('/api/integrations/sync', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ provider }),
 });
 const result = await res.json();
 if (res.ok) {
 setSyncResult({
 provider,
 message: result.synced > 0
 ? `Synced ${result.synced} transaction${result.synced !== 1 ? 's' : ''}${result.failed ? ` (${result.failed} failed)` : ''}`
 : result.message || 'All transactions already synced',
 type: result.failed > 0 ? 'error' : 'success',
 });
 fetchStatus();
 } else {
 setSyncResult({ provider, message: result.error || 'Sync failed', type: 'error' });
 }
 } catch {
 setSyncResult({ provider, message: 'Network error', type: 'error' });
 } finally { setSyncing(null); }
 }

 async function connectCalendly() {
 if (!calendlyToken.trim()) return;
 setCalendlyConnecting(true);
 setSyncResult(null);
 try {
   const res = await fetch('/api/integrations/calendly/connect', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ access_token: calendlyToken.trim() }),
   });
   const json = await res.json();
   if (res.ok) {
     setCalendly({ connected: true, user_name: json.user_name, user_email: json.user_email, webhook_registered: json.webhook_registered });
     setCalendlyToken('');
     setShowCalendlyInput(false);
     setSyncResult({ provider: 'calendly', message: `Calendly connected as ${json.user_name}!`, type: 'success' });
   } else {
     setSyncResult({ provider: 'calendly', message: json.error || 'Failed to connect', type: 'error' });
   }
 } catch {
   setSyncResult({ provider: 'calendly', message: 'Network error', type: 'error' });
 } finally { setCalendlyConnecting(false); }
 }

 async function disconnectCalendly() {
 if (!confirm('Disconnect Calendly? Future bookings will no longer sync automatically.')) return;
 setCalendlyDisconnecting(true);
 try {
   await fetch('/api/integrations/calendly/disconnect', { method: 'POST' });
   setCalendly({ connected: false });
   setSyncResult({ provider: 'calendly', message: 'Calendly disconnected.', type: 'success' });
 } finally { setCalendlyDisconnecting(false); }
 }

 async function syncCalendly() {
 setCalendlySyncing(true);
 setSyncResult(null);
 try {
   const res = await fetch('/api/integrations/calendly/sync', { method: 'POST' });
   const json = await res.json();
   if (res.ok) {
     setSyncResult({
       provider: 'calendly',
       message: json.created > 0
         ? `Imported ${json.created} new event${json.created !== 1 ? 's' : ''} from Calendly${json.skipped > 0 ? ` (${json.skipped} already existed)` : ''}`
         : `All ${json.total} upcoming Calendly events already imported`,
       type: 'success',
     });
   } else {
     setSyncResult({ provider: 'calendly', message: json.error || 'Sync failed', type: 'error' });
   }
 } catch {
   setSyncResult({ provider: 'calendly', message: 'Network error', type: 'error' });
 } finally { setCalendlySyncing(false); }
 }

 function getIntegration(provider: string) {
 return data?.integrations.find(i => i.provider === provider) || null;
 }

 return (
 <div>
 <div className="mb-8">
 <h1 className="font-heading text-2xl text-gray-900">Integrations</h1>
 <p className="mt-1 text-sm text-gray-500">
 Connect your tools to sync data automatically with StoryPay.
 </p>
 </div>

 {syncResult && (
 <div className={`mb-6 flex items-start gap-3 rounded-xl px-4 py-3 text-sm ${
 syncResult.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
 }`}>
 {syncResult.type === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0"/> : <AlertCircle size={16} className="mt-0.5 shrink-0"/>}
 <span>{syncResult.message}</span>
 <button onClick={() => setSyncResult(null)} className="ml-auto text-current opacity-50 hover:opacity-100">
 <XCircle size={14} />
 </button>
 </div>
 )}

 {loading ? (
 <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-400"/></div>
 ) : (
 <div className="space-y-4">

 {/* ── Calendly ── */}
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
   <div className="px-6 py-5">
     <div className="flex items-start gap-4">
       <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl"
         style={{ backgroundColor: '#006BFF18' }}>
         <Calendar size={22} style={{ color: '#006BFF' }} />
       </div>
       <div className="flex-1 min-w-0">
         <div className="flex items-center gap-2 flex-wrap">
           <h3 className="text-base font-semibold text-gray-900">Calendly</h3>
           {calendly?.connected ? (
             <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
               <CheckCircle2 size={10} /> Connected
             </span>
           ) : (
             <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
               Not connected
             </span>
           )}
           {calendly?.connected && !calendly.webhook_registered && (
             <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
               Webhooks inactive
             </span>
           )}
         </div>
         <p className="mt-1 text-sm text-gray-500">
           Sync Calendly bookings to your StoryPay calendar automatically. When someone books a tour or meeting in Calendly, it appears instantly on your calendar.
         </p>
         {calendly?.connected && (
           <p className="mt-2 text-xs text-gray-400">
             Connected as <span className="text-gray-600 font-medium">{calendly.user_name}</span>
             {calendly.user_email && <> ({calendly.user_email})</>}
             {calendly.webhook_registered
               ? ' · Real-time sync active'
               : ' · Manual sync only (webhook not registered — check your app URL env var)'}
           </p>
         )}
         {calendly?.error && <p className="mt-1 text-xs text-amber-600">{calendly.error}</p>}
       </div>

       <div className="flex items-center gap-2 shrink-0">
         {calendly?.connected ? (
           <>
             <button
               onClick={syncCalendly}
               disabled={calendlySyncing}
               className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-all"
               style={{ backgroundColor: '#006BFF' }}
             >
               {calendlySyncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
               {calendlySyncing ? 'Syncing…' : 'Sync Now'}
             </button>
             <button
               onClick={disconnectCalendly}
               disabled={calendlyDisconnecting}
               className="flex items-center gap-1.5 rounded-2xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-60"
             >
               {calendlyDisconnecting ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />}
               Disconnect
             </button>
           </>
         ) : (
           <button
             onClick={() => setShowCalendlyInput(v => !v)}
             className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-all"
             style={{ backgroundColor: '#006BFF' }}
           >
             <Link2 size={14} /> Connect
           </button>
         )}
       </div>
     </div>

     {/* PAT input form */}
     {showCalendlyInput && !calendly?.connected && (
       <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
         <p className="text-xs font-semibold text-gray-700 mb-1">Personal Access Token</p>
         <p className="text-xs text-gray-500 mb-3">
           Generate a token at{' '}
           <a href="https://calendly.com/integrations/api_webhooks" target="_blank" rel="noreferrer"
             className="text-blue-600 hover:underline inline-flex items-center gap-1">
             calendly.com/integrations/api_webhooks <ExternalLink size={10} />
           </a>
           {' '}→ API & Webhooks → Personal Access Tokens → Generate New Token.
         </p>
         <div className="flex gap-2">
           <input
             type="password"
             value={calendlyToken}
             onChange={e => setCalendlyToken(e.target.value)}
             placeholder="eyJhbGciOiJIUzI1NiJ9..."
             className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 font-mono focus:border-gray-400 focus:outline-none"
           />
           <button
             onClick={connectCalendly}
             disabled={calendlyConnecting || !calendlyToken.trim()}
             className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-all"
             style={{ backgroundColor: '#006BFF' }}
           >
             {calendlyConnecting ? <Loader2 size={14} className="animate-spin" /> : null}
             {calendlyConnecting ? 'Connecting…' : 'Connect'}
           </button>
           <button onClick={() => { setShowCalendlyInput(false); setCalendlyToken(''); }}
             className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-500 hover:bg-gray-100 transition-colors">
             Cancel
           </button>
         </div>
       </div>
     )}
   </div>
   {calendly?.connected && (
     <div className="border-t border-gray-200 bg-gray-50/50 px-6 py-3">
       <div className="flex items-center gap-2 text-xs text-gray-400">
         <ArrowRight size={11} />
         <span>Calendly bookings sync one-way into your StoryPay calendar as events. Customer profiles are created automatically.</span>
       </div>
     </div>
   )}
 </div>

 {/* ── Google Calendar / Outlook / Apple Calendar — iCal subscription ── */}
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
   <div className="px-6 py-5">
     <div className="flex items-start gap-4">
       <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl"
         style={{ backgroundColor: '#EA433518' }}>
         📅
       </div>
       <div className="flex-1 min-w-0">
         <div className="flex items-center gap-2 flex-wrap">
           <h3 className="text-base font-semibold text-gray-900">Google Calendar, Outlook & Apple Calendar</h3>
           <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
             <CheckCircle2 size={10} /> Always Active
           </span>
         </div>
         <p className="mt-1 text-sm text-gray-500">
           Subscribe to your StoryPay calendar from any calendar app. Your events sync automatically — no login required.
           This is a <strong>one-way</strong> feed: StoryPay events appear in your personal calendar.
         </p>
       </div>
     </div>

     {icalUrl && (
       <div className="mt-5 space-y-5">
         {/* iCal URL */}
         <div>
           <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Your iCal Subscription URL</p>
           <div className="flex items-center gap-2">
             <code className="flex-1 truncate rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-xs font-mono text-gray-700">
               {icalUrl}
             </code>
             <button
               onClick={() => { navigator.clipboard.writeText(icalUrl); setIcalCopied('ical'); setTimeout(() => setIcalCopied(null), 2500); }}
               className="shrink-0 flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
             >
               {icalCopied === 'ical' ? <CheckCircle2 size={13} className="text-emerald-500" /> : <ExternalLink size={13} />}
               {icalCopied === 'ical' ? 'Copied!' : 'Copy'}
             </button>
           </div>
         </div>

         {/* Step-by-step instructions */}
         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
           {/* Google Calendar */}
           <div className="rounded-xl border border-gray-200 p-4">
             <div className="flex items-center gap-2 mb-3">
               <span className="text-lg">🗓️</span>
               <p className="text-sm font-semibold text-gray-900">Google Calendar</p>
             </div>
             <ol className="space-y-1.5 text-xs text-gray-600 list-decimal list-inside">
               <li>Open Google Calendar on desktop</li>
               <li>Click <strong>+</strong> next to &ldquo;Other calendars&rdquo;</li>
               <li>Choose <strong>From URL</strong></li>
               <li>Paste your iCal URL above</li>
               <li>Click <strong>Add calendar</strong></li>
             </ol>
             <a
               href="https://calendar.google.com/calendar/r/settings/addbyurl"
               target="_blank"
               rel="noreferrer"
               className="mt-3 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
             >
               Open Google Calendar <ExternalLink size={10} />
             </a>
           </div>

           {/* Outlook */}
           <div className="rounded-xl border border-gray-200 p-4">
             <div className="flex items-center gap-2 mb-3">
               <span className="text-lg">📘</span>
               <p className="text-sm font-semibold text-gray-900">Outlook / Microsoft 365</p>
             </div>
             <ol className="space-y-1.5 text-xs text-gray-600 list-decimal list-inside">
               <li>Open Outlook Calendar</li>
               <li>Click <strong>Add calendar</strong></li>
               <li>Choose <strong>Subscribe from web</strong></li>
               <li>Paste your iCal URL above</li>
               <li>Click <strong>Import</strong></li>
             </ol>
             <a
               href="https://outlook.live.com/calendar/0/addfromweb"
               target="_blank"
               rel="noreferrer"
               className="mt-3 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
             >
               Open Outlook Calendar <ExternalLink size={10} />
             </a>
           </div>

           {/* Apple Calendar */}
           <div className="rounded-xl border border-gray-200 p-4">
             <div className="flex items-center gap-2 mb-3">
               <span className="text-lg">🍎</span>
               <p className="text-sm font-semibold text-gray-900">Apple Calendar (Mac / iPhone)</p>
             </div>
             <ol className="space-y-1.5 text-xs text-gray-600 list-decimal list-inside">
               <li>Open Calendar on Mac</li>
               <li>Click <strong>File → New Calendar Subscription</strong></li>
               <li>Paste your iCal URL above</li>
               <li>Set auto-refresh to <strong>Every hour</strong></li>
               <li>Click <strong>OK</strong></li>
             </ol>
             <p className="mt-3 text-[11px] text-gray-400">iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar</p>
           </div>
         </div>

         {/* Availability page */}
         <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
           <p className="text-xs font-semibold text-blue-800 mb-1">Public Availability Page</p>
           <p className="text-xs text-blue-700 mb-2">Share this link with prospects so they can check which dates are open — no customer info is exposed.</p>
           <div className="flex items-center gap-2">
             <code className="flex-1 truncate rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-mono text-blue-800">
               {availabilityUrl}
             </code>
             <button
               onClick={() => { navigator.clipboard.writeText(availabilityUrl); setIcalCopied('avail'); setTimeout(() => setIcalCopied(null), 2500); }}
               className="shrink-0 flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors"
             >
               {icalCopied === 'avail' ? <CheckCircle2 size={12} className="text-emerald-500" /> : <ExternalLink size={12} />}
               {icalCopied === 'avail' ? 'Copied!' : 'Copy'}
             </button>
             <a href={availabilityUrl} target="_blank" rel="noreferrer"
               className="shrink-0 flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors">
               Preview <ExternalLink size={11} />
             </a>
           </div>
         </div>
       </div>
     )}
   </div>
   <div className="border-t border-gray-200 bg-gray-50/50 px-6 py-3">
     <div className="flex items-center gap-2 text-xs text-gray-400">
       <ArrowRight size={11} />
       <span>Events update automatically in your calendar app. Refresh interval depends on the app (Google Calendar updates within ~12 hours; Outlook within a few hours).</span>
     </div>
   </div>
 </div>

 {/* ── Accounting integrations ── */}
 {(Object.entries(PROVIDERS) as [keyof typeof PROVIDERS, typeof PROVIDERS[keyof typeof PROVIDERS]][]).map(([key, provider]) => {
 const integration = getIntegration(key);
 const isConnected = !!integration;
 const isAvailable = data?.available[key] ?? false;

 return (
 <div key={key} className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="px-6 py-5">
 <div className="flex items-start gap-4">
 <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl"
 style={{ backgroundColor: provider.color + '12' }}>
 {provider.logo}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <h3 className="text-base font-semibold text-gray-900">{provider.name}</h3>
 {isConnected ? (
 <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
 <CheckCircle2 size={10} /> Connected
 </span>
 ) : (
 <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
 Not connected
 </span>
 )}
 </div>
 <p className="mt-1 text-sm text-gray-500">{provider.description}</p>

 {isConnected && integration && (
 <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
 {integration.company_name && (
 <span>Account: <span className="text-gray-600 font-medium">{integration.company_name}</span></span>
 )}
 <span>Connected {timeAgo(integration.connected_at)}</span>
 {integration.last_synced_at && (
 <span className="flex items-center gap-1">
 <Clock size={10} /> Last synced {timeAgo(integration.last_synced_at)}
 </span>
 )}
 </div>
 )}
 </div>

 <div className="flex items-center gap-2 shrink-0">
 {isConnected ? (
 <>
 <button
 onClick={() => syncNow(key)}
 disabled={syncing === key}
 className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-all"
 style={{ backgroundColor: provider.color }}
 >
 {syncing === key ? <Loader2 size={14} className="animate-spin"/> : <RefreshCw size={14} />}
 {syncing === key ? 'Syncing...' : 'Sync Now'}
 </button>
 <button
 onClick={() => disconnect(key)}
 disabled={disconnecting === key}
 className="flex items-center gap-1.5 rounded-2xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-60"
 >
 {disconnecting === key ? <Loader2 size={14} className="animate-spin"/> : <Unlink size={14} />}
 Disconnect
 </button>
 </>
 ) : isAvailable ? (
 <button
 onClick={() => connect(key)}
 disabled={connecting === key}
 className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-all"
 style={{ backgroundColor: provider.color }}
 >
 {connecting === key ? <Loader2 size={14} className="animate-spin"/> : <Link2 size={14} />}
 {connecting === key ? 'Connecting...' : 'Connect'}
 </button>
 ) : (
 <a
 href={provider.setupUrl}
 target="_blank"
 rel="noopener noreferrer"
 className="flex items-center gap-1.5 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
 >
 <ExternalLink size={14} />
 Setup Required
 </a>
 )}
 </div>
 </div>
 </div>

 {isConnected && (
 <div className="border-t border-gray-200 bg-gray-50/50 px-6 py-3">
 <div className="flex items-center gap-2 text-xs text-gray-400">
 <ArrowRight size={11} />
 <span>StoryPay paid transactions sync one-way into {provider.shortName} as {key === 'quickbooks' ? 'sales receipts' : 'invoices'}</span>
 </div>
 </div>
 )}
 </div>
 );
 })}
 </div>
 )}

 {/* Recent sync log */}
 {data && data.recentSyncs.length > 0 && (
 <div className="mt-8">
 <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent Sync Activity</h2>
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-50">
 {data.recentSyncs.map(log => (
 <div key={log.id} className="flex items-center gap-3 px-4 py-3">
 {log.status === 'success' ? (
 <CheckCircle2 size={14} className="text-emerald-500 shrink-0"/>
 ) : (
 <XCircle size={14} className="text-red-400 shrink-0"/>
 )}
 <div className="flex-1 min-w-0">
 <p className="text-xs text-gray-700 truncate">
 {log.status === 'success'
 ? `Synced to ${log.provider}${log.external_id ? ` (ID: ${log.external_id})` : ''}`
 : `Failed: ${log.error_message || 'Unknown error'}`
 }
 </p>
 </div>
 <span className="text-[11px] text-gray-400 shrink-0">{timeAgo(log.synced_at)}</span>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Setup instructions */}
 <div className="mt-8 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6">
 <h3 className="text-sm font-semibold text-gray-700 mb-2">Setup Instructions</h3>
 <div className="text-sm text-gray-500 space-y-2">
 <p>To enable accounting integrations, you need to configure OAuth credentials:</p>
 <ol className="list-decimal list-inside space-y-1 text-xs">
 <li><strong>QuickBooks:</strong> Create an app at <a href="https://developer.intuit.com"target="_blank"rel="noopener noreferrer"className="text-blue-600 underline">developer.intuit.com</a> and add your Client ID, Client Secret, and Redirect URI as environment variables.</li>
 <li><strong>FreshBooks:</strong> Create an app at <a href="https://my.freshbooks.com/#/developer"target="_blank"rel="noopener noreferrer"className="text-blue-600 underline">my.freshbooks.com/#/developer</a> and add your Client ID, Client Secret, and Redirect URI as environment variables.</li>
 </ol>
 <div className="mt-3 rounded-lg bg-white border border-gray-200 p-3">
 <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Environment Variables Needed</p>
 <div className="font-mono text-xs text-gray-600 space-y-0.5">
 <p>QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, QUICKBOOKS_REDIRECT_URI</p>
 <p>FRESHBOOKS_CLIENT_ID, FRESHBOOKS_CLIENT_SECRET, FRESHBOOKS_REDIRECT_URI</p>
 <p className="text-gray-400">QUICKBOOKS_SANDBOX=true (optional, for testing)</p>
 </div>
 </div>
 </div>
 </div>
 </div>
 );
}
