'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Loader2, Save, Upload, ImageIcon, X, CheckCircle2, FileText, Link2, FileBadge, Mail } from 'lucide-react';

const COLOR_PRESETS = [
 { label: 'Default', primary: '#1b1b1b', bg: '#ffffff', btnText: '#ffffff' },
 { label: 'Ivory & Gold', primary: '#C6A96B', bg: '#ffffff', btnText: '#ffffff' },
 { label: 'Sage & Stone', primary: '#7A8A6B', bg: '#ffffff', btnText: '#ffffff' },
 { label: 'Black & Champagne', primary: '#1A1A1A', bg: '#ffffff', btnText: '#ffffff' },
 { label: 'Blush & Cream', primary: '#D8A7A3', bg: '#ffffff', btnText: '#ffffff' },
 { label: 'Coastal Blue', primary: '#3A5A6B', bg: '#ffffff', btnText: '#ffffff' },
 { label: 'Warm Earth', primary: '#C46A4A', bg: '#ffffff', btnText: '#ffffff' },
];

interface BrandState {
 logo_url: string;
 primary: string;
 bg: string;
 btnText: string;
 venueName: string;
 email: string;
 phone: string;
 website: string;
 address: string;
 city: string;
 state: string;
 zip: string;
 footer_note: string;
}

function ColorSwatch({ color, label, selected, onClick }: { color: string; label: string; selected: boolean; onClick: () => void }) {
 return (
 <button
 type="button"
 onClick={onClick}
 className={`flex items-center gap-2 rounded-2xl border-2 px-3 py-2.5 text-xs font-medium transition-all text-left leading-tight ${
 selected ? 'border-gray-900 ' : 'border-gray-200 hover:border-gray-300'
 }`}
 >
 <span className="h-4 w-4 rounded-full flex-shrink-0 border border-black/10"style={{ backgroundColor: color }} />
 <span className="break-words leading-tight">{label}</span>
 </button>
 );
}

function LivePreview({ brand }: { brand: BrandState }) {
 return (
 <div className="rounded-2xl border border-gray-200 overflow-hidden bg-white">
 {/* White header + brand-color strip — matches actual sent emails */}
 <div className="px-6 py-4 bg-white"style={{ borderBottom: `4px solid ${brand.primary}` }}>
 <div className="flex items-center justify-between gap-4">
 <div className="min-w-0">
 {brand.logo_url ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img src={brand.logo_url} alt="Logo"className="max-h-12 max-w-[150px] object-contain"
 onError={e => (e.currentTarget.style.display = 'none')} />
 ) : (
 <p className="font-bold text-gray-900 text-sm truncate">{brand.venueName || 'Your Venue'}</p>
 )}
 </div>
 <div className="text-right flex-shrink-0">
 <p className="font-bold text-sm text-gray-900">INVOICE</p>
 <p className="text-xs text-gray-400">INV-2026-0001</p>
 </div>
 </div>
 </div>

 {/* Invoice body */}
 <div className="px-6 py-4">
 <div className="grid grid-cols-2 gap-4 mb-4 text-xs">
 <div>
 <p className="text-gray-400 uppercase tracking-wider font-semibold mb-1">Bill To</p>
 <p className="font-semibold text-gray-900">Jane & John Smith</p>
 <p className="text-gray-500">jane@example.com</p>
 </div>
 <div className="text-right">
 <p className="text-gray-400 uppercase tracking-wider font-semibold mb-1">Due Date</p>
 <p className="font-semibold text-gray-900">June 15, 2026</p>
 </div>
 </div>

 <div className="border border-gray-200 rounded-xl overflow-hidden mb-4">
 <div className="px-4 py-2 bg-gray-50 grid grid-cols-[1fr_80px] text-[10px] font-semibold uppercase tracking-wider text-gray-400">
 <span>Description</span>
 <span className="text-right">Amount</span>
 </div>
 {[
 { desc: 'Grand Ballroom — Full Day', amount: '$4,500.00' },
 { desc: 'Catering Package', amount: '$2,200.00' },
 { desc: 'Processing Fee (2.75%)', amount: '$184.25' },
 ].map((row, i) => (
 <div key={i} className="px-4 py-2.5 grid grid-cols-[1fr_80px] text-xs border-t border-gray-50">
 <span className="text-gray-700">{row.desc}</span>
 <span className="text-right font-medium text-gray-900">{row.amount}</span>
 </div>
 ))}
 <div className="px-4 py-3 grid grid-cols-[1fr_80px] border-t-2 border-gray-200">
 <span className="text-sm font-bold text-gray-900">Total Due</span>
 <span className="text-right text-base font-bold text-gray-900">$6,884.25</span>
 </div>
 </div>

 {/* Pay button */}
 <button
 className="w-full rounded-xl py-3 text-sm font-bold transition-colors"
 style={{ backgroundColor: brand.primary, color: brand.btnText }}
 >
 Pay Now
 </button>

 {/* Footer note */}
 {brand.footer_note && (
 <p className="mt-3 text-[10px] text-gray-400 text-center leading-relaxed">{brand.footer_note}</p>
 )}

 <p className="mt-2 text-[10px] text-gray-300 text-center">Powered by StoryPay</p>
 </div>
 </div>
 );
}

export default function BrandingPage() {
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [saved, setSaved] = useState(false);
 const [logoUploading, setLogoUploading] = useState(false);
 const [logoError, setLogoError] = useState('');
 const fileRef = useRef<HTMLInputElement>(null);
 const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

 const [brand, setBrand] = useState<BrandState>({
 logo_url: '', primary: '#1b1b1b', bg: '#ffffff', btnText: '#ffffff',
 venueName: '', email: '', phone: '', website: '',
 address: '', city: '', state: '', zip: '', footer_note: '',
 });

 useEffect(() => {
 fetch('/api/venues/me', { cache: 'no-store' }).then(r => r.json()).then(d => {
 setBrand({
 logo_url: d.brand_logo_url || '',
 primary: d.brand_color || '#1b1b1b',
 bg: d.brand_bg_color || '#ffffff',
 btnText: d.brand_btn_text || '#ffffff',
 venueName: d.name || '',
 email: d.brand_email || '',
 phone: d.brand_phone || '',
 website: d.brand_website || '',
 address: d.brand_address || '',
 city: d.brand_city || '',
 state: d.brand_state || '',
 zip: d.brand_zip || '',
 footer_note: d.brand_footer_note || '',
 });
 }).finally(() => setLoading(false));
 }, []);

 async function applyPreset(p: typeof COLOR_PRESETS[0]) {
 const next = { primary: p.primary, bg: '#ffffff', btnText: p.btnText };
 setBrand(b => ({ ...b, ...next }));
 // Auto-save immediately so preset changes persist on refresh
 setSaving(true);
 try {
 const res = await fetch('/api/venues/me', {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 brand_color: next.primary,
 brand_bg_color: next.bg,
 brand_btn_text: next.btnText,
 }),
 });
 if (res.ok) {
 setSaved(true);
 setTimeout(() => setSaved(false), 2000);
 } else {
 console.error('[branding preset] save failed:', await res.text());
 }
 } finally {
 setSaving(false);
 }
 }

 // Memoised so color pickers can use it in useCallback deps safely
 const saveNow = useCallback(async (partial: Partial<Record<string, string | null>>) => {
 try {
 await fetch('/api/venues/me', {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(partial),
 });
 } catch { /* non-critical */ }
 }, []);

 function upd(k: keyof BrandState, dbField?: string) {
 return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
 const val = e.target.value;
 setBrand(b => ({ ...b, [k]: val }));
 // Debounce auto-save for color pickers (fires 800ms after user stops dragging)
 if (dbField) {
 if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
 autoSaveTimer.current = setTimeout(() => {
 saveNow({ [dbField]: val });
 }, 800);
 }
 };
 }

 async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
 const file = e.target.files?.[0];
 if (!file) return;
 setLogoUploading(true); setLogoError('');
 try {
 const fd = new FormData();
 fd.append('file', file);
 const res = await fetch('/api/venues/upload-logo', { method: 'POST', body: fd });
 const data = await res.json();
 if (!res.ok) { setLogoError(data.error || 'Upload failed'); return; }
 setBrand(b => ({ ...b, logo_url: data.url }));
 } catch { setLogoError('Upload failed. Please try again.'); }
 finally { setLogoUploading(false); if (e.target) e.target.value = ''; }
 }

 async function save() {
 setSaving(true);
 try {
 const res = await fetch('/api/venues/me', {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 name: brand.venueName,
 brand_logo_url: brand.logo_url || null,
 brand_color: brand.primary,
 brand_bg_color: brand.bg,
 brand_btn_text: brand.btnText,
 brand_email: brand.email,
 brand_phone: brand.phone,
 brand_website: brand.website,
 brand_address: brand.address,
 brand_city: brand.city,
 brand_state: brand.state,
 brand_zip: brand.zip,
 brand_footer_note: brand.footer_note,
 }),
 });
 // Parse body once regardless of status
 const data = await res.json().catch(() => ({}));
 if (!res.ok) {
 console.error('[branding] save failed:', data);
 return;
 }
 // Sync local state from DB response so preview stays accurate
 setBrand(b => ({
 ...b,
 primary: data.brand_color || b.primary,
 bg: data.brand_bg_color || b.bg,
 btnText: data.brand_btn_text || b.btnText,
 logo_url: data.brand_logo_url ?? '',
 }));
 setSaved(true);
 setTimeout(() => setSaved(false), 3000);
 } finally { setSaving(false); }
 }

 const INPUT = 'w-full rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors';
 const LABEL = 'block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide';

 if (loading) return <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-400"/></div>;

 return (
 <div>
 {/* Header */}
 <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
 <div>
 <h1 className="font-heading text-2xl text-gray-900">Branding &amp; Customization</h1>
 <p className="mt-1 text-sm text-gray-500">Customize your brand colors and logo for invoices and payment links</p>
 </div>
 <button
 onClick={save}
 disabled={saving}
 className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all"
 style={{ backgroundColor: '#1b1b1b' }}
 >
 {saving ? <Loader2 size={15} className="animate-spin"/> : saved ? <CheckCircle2 size={15} /> : <Save size={15} />}
 {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Branding Settings'}
 </button>
 </div>

 <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6 items-start">

 {/* ── Left: Brand Settings ── */}
 <div className="space-y-6">

 {/* Brand Settings card */}
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="px-6 py-4 border-b border-gray-200">
 <h2 className="text-base font-semibold text-gray-900">Brand Settings</h2>
 </div>
 <div className="px-6 py-5 space-y-5">

 {/* Logo */}
 <div>
 <label className={LABEL}>Logo</label>
 <div className="flex items-start gap-4">
 {/* Preview box */}
 <div className="flex-shrink-0 h-20 w-36 rounded-2xl border-2 border-dashed border-gray-200 bg-white flex items-center justify-center overflow-hidden relative">
 {brand.logo_url ? (
 <>
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img src={brand.logo_url} alt="Logo"className="h-full w-full object-contain p-2"
 onError={e => (e.currentTarget.style.display = 'none')} />
 <button type="button"onClick={async () => {
 setBrand(b => ({ ...b, logo_url: '' }));
 // Immediately persist the removal so refresh doesn't restore the old logo
 await fetch('/api/venues/me', {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ brand_logo_url: null }),
 });
 }}
 className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white">
 <X size={9} />
 </button>
 </>
 ) : (
 <div className="flex flex-col items-center gap-1 text-gray-300">
 <ImageIcon size={22} />
 <span className="text-[10px]">No logo</span>
 </div>
 )}
 </div>
 {/* Upload controls — no URL input */}
 <div className="flex-1 space-y-2">
 <input ref={fileRef} type="file"accept="image/*"className="hidden"onChange={handleLogoUpload} />
 <button type="button"onClick={() => fileRef.current?.click()} disabled={logoUploading}
 className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all disabled:opacity-50 w-full justify-center">
 {logoUploading ? <Loader2 size={14} className="animate-spin"/> : <Upload size={14} />}
 {logoUploading ? 'Uploading...' : brand.logo_url ? 'Replace Logo' : 'Upload Logo'}
 </button>
 <p className="text-[10px] text-gray-400">PNG, JPG, SVG — max 5MB. This logo will appear on all emails and invoices.</p>
 {logoError && <p className="text-xs text-red-500">{logoError}</p>}
 </div>
 </div>
 </div>
 </div>
 </div>

 {/* Color Presets */}
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="px-6 py-4 border-b border-gray-200">
 <h2 className="text-base font-semibold text-gray-900">Color Presets</h2>
 </div>
 <div className="px-6 py-5">
 <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
 {COLOR_PRESETS.map(p => (
 <ColorSwatch
 key={p.label}
 color={p.primary}
 label={p.label}
 selected={brand.primary === p.primary}
 onClick={() => applyPreset(p)}
 />
 ))}
 </div>
 </div>
 </div>

 {/* Custom Colors */}
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="px-6 py-4 border-b border-gray-200">
 <h2 className="text-base font-semibold text-gray-900">Custom Colors</h2>
 </div>
 <div className="px-6 py-5">
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
 {[
 { label: 'Primary / Button Color', key: 'primary' as const, db: 'brand_color' },
 { label: 'Background Color', key: 'bg' as const, db: 'brand_bg_color' },
 { label: 'Button Text Color', key: 'btnText' as const, db: 'brand_btn_text' },
 ].map(({ label, key, db }) => (
 <div key={key}>
 <label className={LABEL}>{label}</label>
 <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 focus-within:border-gray-400 focus-within:bg-white transition-colors">
 <input
 type="color"
 value={brand[key]}
 onChange={upd(key, db)}
 className="h-7 w-7 rounded-lg cursor-pointer border-0 p-0 bg-transparent flex-shrink-0"
 />
 <input
 type="text"
 value={brand[key]}
 onChange={upd(key, db)}
 maxLength={7}
 placeholder="#000000"
 className="flex-1 bg-transparent text-sm font-mono text-gray-900 focus:outline-none placeholder:text-gray-400"
 />
 </div>
 </div>
 ))}
 </div>
 </div>
 </div>

 {/* Contact & Footer */}
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="px-6 py-4 border-b border-gray-200">
 <h2 className="text-base font-semibold text-gray-900">Contact Information</h2>
 <p className="text-xs text-gray-400 mt-0.5">Shown on invoices and proposals</p>
 </div>
 <div className="px-6 py-5 space-y-4">
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
 <div className="sm:col-span-2">
 <label className={LABEL}>Business Name</label>
 <input type="text"value={brand.venueName} onChange={upd('venueName')} placeholder="Your Venue Name"className={INPUT} />
 </div>
 <div>
 <label className={LABEL}>Contact Email</label>
 <input type="email"value={brand.email} onChange={upd('email')} placeholder="hello@yourvenue.com"className={INPUT} />
 </div>
 <div>
 <label className={LABEL}>Contact Phone</label>
 <input type="tel"value={brand.phone} onChange={upd('phone')} placeholder="(555) 000-0000"className={INPUT} />
 </div>
 <div className="sm:col-span-2">
 <label className={LABEL}>Website</label>
 <input type="url"value={brand.website} onChange={upd('website')} placeholder="https://yourvenue.com"className={INPUT} />
 </div>
 <div className="sm:col-span-2">
 <label className={LABEL}>Street Address</label>
 <input type="text"value={brand.address} onChange={upd('address')} placeholder="123 Wedding Lane"className={INPUT} />
 </div>
 <div>
 <label className={LABEL}>City</label>
 <input type="text"value={brand.city} onChange={upd('city')} placeholder="Columbus"className={INPUT} />
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className={LABEL}>State</label>
 <input type="text"value={brand.state} onChange={upd('state')} placeholder="OH"maxLength={2} className={INPUT} />
 </div>
 <div>
 <label className={LABEL}>ZIP</label>
 <input type="text"value={brand.zip} onChange={upd('zip')} placeholder="43215"className={INPUT} />
 </div>
 </div>
 </div>
 <div>
 <label className={LABEL}>Footer Note</label>
 <textarea value={brand.footer_note} onChange={upd('footer_note')}
 placeholder="Thank you for choosing our venue. All payments are non-refundable unless otherwise stated."
 rows={2}
 className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors resize-none"
 />
 </div>
 </div>
 </div>

 {/* Applies to */}
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="px-6 py-4 border-b border-gray-200">
 <h2 className="text-base font-semibold text-gray-900">Note</h2>
 </div>
 <div className="px-6 py-5">
 <p className="text-sm text-gray-500 mb-4">These branding settings will apply to:</p>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 {[
 { icon: FileText, label: 'Public invoice pages' },
 { icon: Link2, label: 'Payment link pages' },
 { icon: FileBadge, label: 'Invoice PDF documents' },
 { icon: Mail, label: 'Email notifications' },
 ].map(({ icon: Icon, label }) => (
 <div key={label} className="flex items-center gap-2.5 text-sm text-gray-600">
 <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100">
 <Icon size={14} className="text-gray-500"/>
 </div>
 {label}
 </div>
 ))}
 </div>
 </div>
 </div>
 </div>

 {/* ── Right: Live Preview ── */}
 <div className="xl:sticky xl:top-10 space-y-3">
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="px-5 py-3.5 border-b border-gray-200">
 <h2 className="text-sm font-semibold text-gray-900">Invoice / Payment Link Preview</h2>
 <p className="text-xs text-gray-400 mt-0.5">Updates in real time as you edit</p>
 </div>
 <div className="p-4">
 <LivePreview brand={brand} />
 </div>
 </div>
 </div>
 </div>
 </div>
 );
}
