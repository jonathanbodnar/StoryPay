'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
 Send, Save, Plus, Trash2, Search, UserPlus, X, ChevronDown,
 FileText, Eye, EyeOff, Loader2, CheckCircle2, Sparkles, ArrowLeft,
} from 'lucide-react';
import { formatCents } from '@/lib/utils';
import dynamic from 'next/dynamic';

const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), { ssr: false });
const AIProposalGenerator = dynamic(() => import('@/components/AIProposalGenerator'), { ssr: false });

// ─── Constants ────────────────────────────────────────────────────────────────
const SURCHARGE_RATE = 0.0275;
const SURCHARGE_ID = '__surcharge__';

// ─── Types ────────────────────────────────────────────────────────────────────
type Mode = 'proposal' | 'invoice';
type PaymentType = 'full' | 'installment' | 'subscription';

interface Customer { id: number; name: string; email: string; phone?: string; }
interface Template { id: string; name: string; content: string; }
interface LineItem { id: string; name: string; description: string; amount: string; isSurcharge?: boolean; }
interface Installment { id: string; amount: string; date: string; }
interface Product { id: string; name: string; description: string | null; price: number; }

function uid() { return Math.random().toString(36).slice(2, 10); }
function today() {
 const d = new Date();
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function emptyItem(): LineItem { return { id: uid(), name: '', description: '', amount: '' }; }
function surcharge(subtotalCents: number): LineItem {
 return { id: SURCHARGE_ID, name: 'Processing Fee (2.75%)', description: 'Credit card processing surcharge', amount: ((subtotalCents * SURCHARGE_RATE) / 100).toFixed(2), isSurcharge: true };
}

const INPUT = 'w-full rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors';
const LABEL = 'block text-sm font-medium text-gray-700 mb-1.5';

// ─── Live Preview ─────────────────────────────────────────────────────────────
function LivePreview({
 mode, clientName, clientEmail, contractHtml, lineItems, paymentType,
 installments, subAmount, subFrequency, venueName, logoUrl, brandColor, onPreview,
}: {
 mode: Mode; clientName: string; clientEmail: string; contractHtml: string;
 lineItems: LineItem[]; paymentType: PaymentType;
 installments: Installment[]; subAmount: string; subFrequency: string;
 venueName: string; logoUrl: string; brandColor: string; onPreview?: () => void;
}) {
 const totalCents = lineItems.reduce((s, i) => { const v = parseFloat(i.amount||'0'); return s + (isNaN(v)?0:Math.round(v*100)); }, 0);

 return (
 <div className="rounded-2xl border border-gray-200 overflow-hidden bg-white text-sm">
 {/* Branded header */}
 <div className="px-5 py-4 flex items-center justify-between"style={{ backgroundColor: brandColor || '#1b1b1b' }}>
 <div className="flex items-center gap-3">
 {logoUrl ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img src={logoUrl} alt="logo"className="h-8 object-contain"onError={e=>(e.currentTarget.style.display='none')} />
 ) : (
 <>
 <div className="h-8 w-8 rounded-lg bg-white/20 flex items-center justify-center text-white font-bold">
 {venueName?.charAt(0)||'V'}
 </div>
 <p className="text-white font-semibold text-sm">{venueName || 'Your Venue'}</p>
 </>
 )}
 </div>
 <div className="text-right">
 <p className="text-white font-bold text-base">{mode === 'invoice' ? 'INVOICE' : 'PROPOSAL'}</p>
 <p className="text-white/60 text-xs">#001</p>
 </div>
 </div>

 <div className="px-5 py-4 space-y-4">
 {/* Client */}
 <div>
 <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Bill To</p>
 <p className="font-semibold text-gray-900">{clientName || 'Client Name'}</p>
 {clientEmail && <p className="text-gray-500 text-xs">{clientEmail}</p>}
 </div>

 {/* Contract preview */}
 {(mode === 'proposal') && contractHtml && (
 <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 max-h-32 overflow-hidden relative">
 <div className="text-xs text-gray-600 leading-relaxed"dangerouslySetInnerHTML={{ __html: contractHtml }} />
 <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-50"/>
 </div>
 )}

 {/* Line items */}
 <div className="rounded-2xl border border-gray-200 overflow-hidden">
 <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 grid grid-cols-[1fr_80px] text-[10px] font-semibold uppercase tracking-wider text-gray-400">
 <span>Description</span><span className="text-right">Amount</span>
 </div>
 {lineItems.filter(i => parseFloat(i.amount||'0') > 0 || i.name).map(item => (
 <div key={item.id} className="px-3 py-2 grid grid-cols-[1fr_80px] border-b border-gray-50 last:border-0">
 <div>
 <p className={`text-xs ${item.isSurcharge ? 'text-gray-500' : 'text-gray-800 font-medium'}`}>{item.name || 'Item'}</p>
 {item.description && <p className="text-[10px] text-gray-400">{item.description}</p>}
 </div>
 <p className="text-xs text-right text-gray-800">{formatCents(Math.round(parseFloat(item.amount||'0')*100))}</p>
 </div>
 ))}
 <div className="px-3 py-2 border-t-2 border-gray-200 grid grid-cols-[1fr_80px]">
 <p className="text-xs font-bold text-gray-900">Total</p>
 <p className="text-xs font-bold text-right text-gray-900">{formatCents(totalCents)}</p>
 </div>
 </div>

 {/* Payment info */}
 {paymentType === 'installment' && installments.length > 0 && (
 <div>
 <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Installment Schedule</p>
 <div className="space-y-1">
 {installments.map((inst, i) => (
 <div key={inst.id} className="flex justify-between text-xs text-gray-600">
 <span>Payment {i+1} — {inst.date || '—'}</span>
 <span className="font-medium">{formatCents(Math.round(parseFloat(inst.amount||'0')*100))}</span>
 </div>
 ))}
 </div>
 </div>
 )}
 {paymentType === 'subscription' && (
 <div className="text-xs text-gray-600">
 <span className="font-medium">{formatCents(Math.round(parseFloat(subAmount||'0')*100))}</span> / {subFrequency}
 </div>
 )}

 {/* CTA */}
 <button onClick={onPreview}
 className="w-full rounded-xl py-2.5 text-sm font-bold text-white flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
 style={{ backgroundColor: brandColor || '#1b1b1b' }}>
 <Eye size={14}/> Preview Full {mode === 'invoice' ? 'Invoice' : 'Proposal'}
 </button>

 <p className="text-[10px] text-gray-300 text-center">Powered by StoryPay</p>
 </div>
 </div>
 );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function NewProposalInvoicePage() {
 const router = useRouter();
 const searchParams = useSearchParams();

 // Mode
 const [mode, setMode] = useState<Mode>('proposal');

 // Customer
 const [customerMode, setCustomerMode] = useState<'search'|'new'>('search');
 const [searchQuery, setSearchQuery] = useState('');
 const [searchResults, setSearchResults] = useState<Customer[]>([]);
 const [searchLoading, setSearchLoading] = useState(false);
 const [selectedCustomer, setSelectedCustomer] = useState<Customer|null>(null);
 const [showDropdown, setShowDropdown] = useState(false);
 const [clientFirst, setClientFirst] = useState('');
 const [clientLast, setClientLast] = useState('');
 const [clientEmail, setClientEmail] = useState('');
 const [clientPhone, setClientPhone] = useState('');
 const clientName = [clientFirst, clientLast].filter(Boolean).join(' ');
 const searchRef = useRef<HTMLDivElement>(null);

 // Contract
 const [templates, setTemplates] = useState<Template[]>([]);
 const [selectedTemplate, setSelectedTemplate] = useState<Template|null>(null);
 const [contractHtml, setContractHtml] = useState('');
 const [showEditor, setShowEditor] = useState(false);
 const [showAI, setShowAI] = useState(false);

 // Line items
 const [lineItems, setLineItems] = useState<LineItem[]>([emptyItem(), surcharge(0)]);
 const [products, setProducts] = useState<Product[]>([]);
 const [productSuggestions, setProductSuggestions] = useState<Record<string,Product[]>>({});
 const [showSuggestions, setShowSuggestions] = useState<Record<string,boolean>>({});
 const suggestTimers = useRef<Record<string,ReturnType<typeof setTimeout>>>({});

 // Payment
 const [paymentType, setPaymentType] = useState<PaymentType>('full');
 const [installments, setInstallments] = useState<Installment[]>([{id:uid(),amount:'',date:''}]);
 const [subAmount, setSubAmount] = useState('');
 const [subFrequency, setSubFrequency] = useState('monthly');
 const [subStartDate, setSubStartDate] = useState('');

 // UI
 const [showPreview, setShowPreview] = useState(false);
 const [showPreviewModal, setShowPreviewModal] = useState(false);
 const [submitting, setSubmitting] = useState(false);
 const [saving, setSaving] = useState(false);
 const [error, setError] = useState('');

 // Branding
 const [venueName, setVenueName] = useState('');
 const [logoUrl, setLogoUrl] = useState('');
 const [brandColor, setBrandColor] = useState('#1b1b1b');

 // Pre-fill from URL params
 useEffect(() => {
 const name = searchParams.get('name');
 const email = searchParams.get('email');
 const type = searchParams.get('type');
 if (type === 'invoice' || type === 'proposal') {
 setMode(type);
 }
 if (name) {
 const parts = name.trim().split(' ');
 setClientFirst(parts[0] || '');
 setClientLast(parts.slice(1).join(' ') || '');
 }
 if (email) setClientEmail(email);
 if (name || email) setCustomerMode('new');
 }, [searchParams]);

 // Load templates + products + branding
 useEffect(() => {
 fetch('/api/templates').then(r=>r.json()).then(d=>setTemplates(Array.isArray(d)?d:[]));
 fetch('/api/products').then(r=>r.json()).then(d=>setProducts(Array.isArray(d)?d:[]));
 fetch('/api/venues/me').then(r=>r.json()).then(d=>{
 setVenueName(d.name||'');
 setLogoUrl(d.brand_logo_url||'');
 // Treat old default #293745 as unset — use #1b1b1b
 const c = d.brand_color;
 setBrandColor(c && c !== '#293745' && c !== '#354859' ? c : '#1b1b1b');
 });
 }, []);

 // Customer search
 const searchCustomers = useCallback(async (q: string) => {
 if (q.length < 1) { setSearchResults([]); return; }
 setSearchLoading(true);
 try {
 const res = await fetch(`/api/contacts?search=${encodeURIComponent(q)}&limit=8`);
 if (res.ok) setSearchResults(await res.json());
 } finally { setSearchLoading(false); }
 }, []);

 useEffect(() => {
 const t = setTimeout(() => searchCustomers(searchQuery), 300);
 return () => clearTimeout(t);
 }, [searchQuery, searchCustomers]);

 useEffect(() => {
 const handler = (e: Event) => {
 if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowDropdown(false);
 };
 // Both mouse and touch for mobile
 document.addEventListener('mousedown', handler);
 document.addEventListener('touchstart', handler);
 return () => {
 document.removeEventListener('mousedown', handler);
 document.removeEventListener('touchstart', handler);
 };
 }, []);

 // ── Line item helpers ──────────────────────────────────────────────────────
 const subtotalCents = lineItems.filter(i=>!i.isSurcharge).reduce((s,i)=>{
 const v=parseFloat(i.amount||'0'); return s+(isNaN(v)?0:Math.round(v*100));
 }, 0);

 const totalCents = lineItems.reduce((s,i)=>{
 const v=parseFloat(i.amount||'0'); return s+(isNaN(v)?0:Math.round(v*100));
 }, 0);

 function updateItem(id: string, field: keyof LineItem, value: string) {
 setLineItems(prev => {
 const updated = prev.map(i => i.id===id ? {...i,[field]:value} : i);
 if (id!==SURCHARGE_ID && field==='amount') {
 const newSub = updated.filter(i=>!i.isSurcharge).reduce((s,i)=>{
 const v=parseFloat(i.amount||'0'); return s+(isNaN(v)?0:Math.round(v*100));
 },0);
 return updated.map(i=>i.isSurcharge?{...i,amount:((newSub*SURCHARGE_RATE)/100).toFixed(2)}:i);
 }
 return updated;
 });
 if (field==='name' && id!==SURCHARGE_ID) {
 clearTimeout(suggestTimers.current[id]);
 suggestTimers.current[id] = setTimeout(()=>{
 const filtered = products.filter(p=>p.name.toLowerCase().includes(value.toLowerCase())).slice(0,5);
 setProductSuggestions(prev=>({...prev,[id]:filtered}));
 setShowSuggestions(prev=>({...prev,[id]:filtered.length>0&&value.length>0}));
 },150);
 }
 }

 function removeItem(id: string) { setLineItems(prev=>prev.filter(i=>i.id!==id)); }

 function addItem() {
 setLineItems(prev=>{
 const nonSurcharge = prev.filter(i=>!i.isSurcharge);
 const surchargeLine = prev.filter(i=>i.isSurcharge);
 return [...nonSurcharge, emptyItem(), ...surchargeLine];
 });
 }

 function selectProduct(itemId: string, p: Product) {
 setLineItems(prev=>{
 const updated = prev.map(i=>i.id===itemId?{...i,name:p.name,description:p.description||'',amount:(p.price/100).toFixed(2)}:i);
 const newSub = updated.filter(i=>!i.isSurcharge).reduce((s,i)=>{const v=parseFloat(i.amount||'0');return s+(isNaN(v)?0:Math.round(v*100));},0);
 return updated.map(i=>i.isSurcharge?{...i,amount:((newSub*SURCHARGE_RATE)/100).toFixed(2)}:i);
 });
 setShowSuggestions(prev=>({...prev,[itemId]:false}));
 }

 function hasSurcharge() { return lineItems.some(i=>i.isSurcharge); }

 // ── Template select ────────────────────────────────────────────────────────
 function selectTemplate(t: Template) {
 setSelectedTemplate(t);
 setContractHtml(t.content||'');
 }

 // ── Submit ─────────────────────────────────────────────────────────────────
 async function submit(asDraft: boolean) {
 setError('');
 if (!clientEmail.trim() || !clientFirst.trim() || !clientLast.trim()) { setError('First name, last name, and email are required.'); return; }
 if (customerMode === 'new' && !clientPhone.trim()) { setError('Phone number is required.'); return; }
 if (totalCents <= 0) { setError('Please add at least one line item with an amount.'); return; }
 if (mode==='proposal' && !selectedTemplate && !contractHtml) {
 if (!asDraft) { setError('Please select or create a contract for this proposal.'); return; }
 }

 asDraft ? setSaving(true) : setSubmitting(true);

 try {
 const lineItemsPayload = lineItems.map(i=>({
 name: i.name, description: i.description,
 amount: Math.round(parseFloat(i.amount||'0')*100),
 }));

 let paymentConfig = {};
 if (paymentType==='installment') {
 paymentConfig = { installments: installments.map(i=>({ amount: Math.round(parseFloat(i.amount||'0')*100), date: i.date })) };
 } else if (paymentType==='subscription') {
 paymentConfig = { amount: Math.round(parseFloat(subAmount||'0')*100), frequency: subFrequency, start_date: subStartDate };
 }

 // If proposal/both — use proposal API with template
 if (mode==='proposal' && selectedTemplate) {
 const res = await fetch('/api/proposals', {
 method: 'POST',
 headers: {'Content-Type':'application/json'},
 body: JSON.stringify({
 templateId: selectedTemplate.id,
 customerName: clientName, customerEmail: clientEmail, customerPhone: clientPhone,
 price: totalCents, paymentType, paymentConfig, asDraft,
 overrideContent: contractHtml !== selectedTemplate.content ? contractHtml : undefined,
 }),
 });
 if (!res.ok) { const d=await res.json(); setError(d.error||'Failed'); return; }
 } else {
 // Invoice only
 const res = await fetch('/api/invoices', {
 method: 'POST',
 headers: {'Content-Type':'application/json'},
 body: JSON.stringify({
 customerName: clientName, customerEmail: clientEmail, customerPhone: clientPhone,
 lineItems: lineItemsPayload, price: totalCents,
 paymentType, paymentConfig, asDraft,
 }),
 });
 if (!res.ok) { const d=await res.json(); setError(d.error||'Failed'); return; }
 }

 router.push('/dashboard/proposals');
 } catch { setError('Network error. Please try again.'); }
 finally { setSaving(false); setSubmitting(false); }
 }

 // ─────────────────────────────────────────────────────────────────────────
 const hasInteracted = clientName || clientEmail || totalCents > 0;

 return (
 <div className="max-w-7xl mx-auto">

 {/* Header */}
 <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
 <div>
 <button onClick={()=>router.back()} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 mb-2 transition-colors">
 <ArrowLeft size={14} /> Back
 </button>
 <h1 className="text-2xl font-bold text-gray-900">New Proposal & Invoice</h1>
 <p className="text-sm text-gray-500 mt-0.5">Create a proposal, invoice, or both — then send to your client</p>
 </div>
 <div className="flex items-center gap-2">
 <button onClick={()=>setShowPreviewModal(true)}
 className="flex items-center gap-1.5 rounded-2xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap">
 <Eye size={14}/> Preview
 </button>
 <button onClick={()=>submit(true)} disabled={saving||submitting}
 className="flex items-center gap-1.5 rounded-2xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 whitespace-nowrap">
 {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
 <span className="hidden sm:inline">{saving ? 'Saving...' : 'Save Draft'}</span>
 <span className="sm:hidden">{saving ? '...' : 'Draft'}</span>
 </button>
 <button onClick={()=>submit(false)} disabled={saving||submitting}
 className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-all whitespace-nowrap"
 style={{backgroundColor:'#1b1b1b'}}>
 {submitting ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
 {submitting ? 'Sending...' : 'Send'}
 </button>
 </div>
 </div>

 {error && <div className="mb-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">{error}</div>}

 <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">

 {/* ── LEFT: Form ── */}
 <div className="space-y-5">

 {/* Mode selector */}
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="px-5 py-4 border-b border-gray-200">
 <p className="text-sm font-semibold text-gray-900">Document Type</p>
 </div>
 <div className="px-5 py-4">
 <div className="grid grid-cols-2 gap-2 max-w-sm">
 {([
 {key:'proposal',label:'Proposal',desc:'Contract → sign → pay'},
 {key:'invoice', label:'Invoice', desc:'Itemized bill → pay directly'},
 ] as {key:Mode;label:string;desc:string}[]).map(m=>(
 <button key={m.key} type="button"onClick={()=>setMode(m.key)}
 className={`rounded-2xl border-2 p-3 text-left transition-all ${mode===m.key?'border-gray-900 bg-gray-50':'border-gray-200 hover:border-gray-300'}`}>
 <p className={`text-sm font-semibold ${mode===m.key?'text-gray-900':'text-gray-600'}`}>{m.label}</p>
 <p className="text-[11px] text-gray-400 mt-0.5">{m.desc}</p>
 </button>
 ))}
 </div>
 </div>
 </div>

 {/* Customer */}
 <div className="rounded-2xl border border-gray-200 bg-white">
 <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
 <p className="text-sm font-semibold text-gray-900">Client</p>
 <div className="flex gap-1">
 {(['search','new'] as const).map(m=>(
 <button key={m} type="button"onClick={()=>setCustomerMode(m)}
 className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${customerMode===m?'bg-gray-100 text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
 {m==='search'?<Search size={12}/>:<UserPlus size={12}/>}
 {m==='search'?'Existing':'New'}
 </button>
 ))}
 </div>
 </div>
 <div className="px-5 py-4">
 {customerMode==='search' ? (
 <div ref={searchRef} className="relative">
 {selectedCustomer ? (
 <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
 <div>
 <p className="text-sm font-semibold text-gray-900">{clientName}</p>
 <p className="text-xs text-gray-500">{clientEmail}</p>
 </div>
 <button onClick={()=>{setSelectedCustomer(null);setClientFirst('');setClientLast('');setClientEmail('');setClientPhone('');setSearchQuery('');}}
 className="text-gray-400 hover:text-gray-600"><X size={15}/></button>
 </div>
 ) : (
 <>
 <div className="relative">
 <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
 <input type="text"value={searchQuery}
 onChange={e=>{setSearchQuery(e.target.value);if(e.target.value.length>=1) setShowDropdown(true);}}
 onFocus={()=>{ if(searchQuery.length>=1) setShowDropdown(true); }}
 placeholder="Search by name, email, or phone..."
 autoComplete="off"
 style={{ fontSize: 16 }}
 className="w-full rounded-2xl border border-gray-200 bg-white pl-9 pr-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors"/>
 {searchLoading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400"/>}
 </div>
 {showDropdown && searchQuery.length>=1 && (
 <div className="absolute z-50 mt-1 w-full rounded-2xl border border-gray-200 bg-white overflow-hidden max-h-56 overflow-y-auto"style={{top:'100%',left:0}}>
 {searchResults.length>0 ? searchResults.map(c=>(
 <button key={c.id} type="button"onClick={()=>{setSelectedCustomer(c);const parts=(c.name||'').trim().split(' ');setClientFirst(parts[0]||'');setClientLast(parts.slice(1).join(' ')||'');setClientEmail(c.email||'');setClientPhone(c.phone||'');setShowDropdown(false);}}
 className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
 <div><p className="text-sm font-medium text-gray-900">{c.name}</p><p className="text-xs text-gray-400">{c.email}</p></div>
 {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
 </button>
 )) : !searchLoading && (
 <div className="px-4 py-3 text-sm text-gray-500">No results. <button type="button"onClick={()=>setCustomerMode('new')} className="text-gray-900 font-medium underline">Create new</button></div>
 )}
 </div>
 )}
 </>
 )}
 </div>
 ) : (
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 <div>
 <label className={LABEL}>First Name <span className="text-red-400">*</span></label>
 <input type="text"value={clientFirst} onChange={e=>setClientFirst(e.target.value)} placeholder="Jane"className={INPUT} style={{fontSize:16}}/>
 </div>
 <div>
 <label className={LABEL}>Last Name <span className="text-red-400">*</span></label>
 <input type="text"value={clientLast} onChange={e=>setClientLast(e.target.value)} placeholder="Smith"className={INPUT} style={{fontSize:16}}/>
 </div>
 <div>
 <label className={LABEL}>Email <span className="text-red-400">*</span></label>
 <input type="email"value={clientEmail} onChange={e=>setClientEmail(e.target.value)} placeholder="jane@example.com"className={INPUT}/>
 </div>
 <div>
 <label className={LABEL}>Phone <span className="text-red-400">*</span></label>
 <input type="tel"required value={clientPhone} onChange={e=>setClientPhone(e.target.value)} placeholder="(555) 000-0000"className={INPUT} style={{fontSize:16}}/>
 </div>
 </div>
 )}
 </div>
 </div>

 {/* Contract (proposal mode) */}
 {mode==='proposal' && (
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
 <p className="text-sm font-semibold text-gray-900">Contract / Proposal</p>
 <div className="flex items-center gap-2">
 <button type="button"onClick={()=>setShowAI(true)}
 className="flex items-center gap-1.5 rounded-2xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
 <Sparkles size={12}/> Generate with AI
 </button>
 {selectedTemplate && (
 <button type="button"onClick={()=>setShowEditor(v=>!v)}
 className="flex items-center gap-1.5 rounded-2xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
 {showEditor?<EyeOff size={12}/>:<Eye size={12}/>}
 {showEditor?'Hide editor':'Edit'}
 </button>
 )}
 </div>
 </div>
 <div className="px-5 py-4 space-y-3">
 <div>
 <label className={LABEL}>Select Template</label>
 <div className="relative">
 <select value={selectedTemplate?.id||''} onChange={e=>{const t=templates.find(t=>t.id===e.target.value);if(t)selectTemplate(t);else{setSelectedTemplate(null);setContractHtml('');}}}
 className={`${INPUT} appearance-none pr-8`}>
 <option value="">Select a template...</option>
 {templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
 </select>
 <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
 </div>
 {templates.length===0 && <p className="text-xs text-gray-400 mt-1">No templates yet. <a href="/dashboard/proposals/templates/new"className="text-gray-700 underline">Create one</a></p>}
 </div>
 {selectedTemplate && (
 <div className="rounded-2xl border border-amber-100 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-700">
 Editing this contract only affects this proposal — your master template stays unchanged.
 </div>
 )}
 {(showEditor || contractHtml) && (
 <div className={showEditor?'':'hidden'}>
 <RichTextEditor content={contractHtml} onChange={setContractHtml} minHeight={300} placeholder="Write or paste your contract terms here..."/>
 </div>
 )}
 {!showEditor && contractHtml && (
 <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 max-h-24 overflow-hidden relative">
 <div className="text-xs text-gray-500 leading-relaxed"dangerouslySetInnerHTML={{__html:contractHtml}}/>
 <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-gray-50"/>
 </div>
 )}
 </div>
 </div>
 )}

 {/* Line Items */}
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="px-5 py-4 border-b border-gray-200">
 <p className="text-sm font-semibold text-gray-900">Line Items</p>
 </div>
 <div>
 {/* Desktop headers */}
 <div className="hidden sm:grid grid-cols-[1fr_180px_110px_36px] gap-3 bg-gray-50 px-5 py-2.5 border-b border-gray-200">
 {['Item / Service','Note','Amount',''].map(h=>(
 <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{h}</span>
 ))}
 </div>
 <div className="divide-y divide-gray-50">
 {lineItems.map((item,idx)=>(
 <div key={item.id} className={`px-5 py-3 ${item.isSurcharge?'bg-gray-50/60':''}`}>
 <div className="flex flex-col sm:grid sm:grid-cols-[1fr_180px_110px_36px] gap-2 sm:gap-3 items-start sm:items-center">
 {/* Name with autocomplete */}
 <div className="relative w-full">
 <input type="text"value={item.name}
 onChange={e=>{updateItem(item.id,'name',e.target.value);}}
 onBlur={()=>setTimeout(()=>setShowSuggestions(p=>({...p,[item.id]:false})),150)}
 placeholder={item.isSurcharge?'Processing Fee (2.75%)':`Item ${idx+1}`}
 className={`w-full rounded-lg border px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none transition-colors ${item.isSurcharge?'border-gray-200 bg-gray-100 text-gray-600 font-medium':'border-gray-200 text-gray-900 focus:border-gray-400'}`}/>
 {!item.isSurcharge && showSuggestions[item.id] && (productSuggestions[item.id]||[]).length>0 && (
 <div className="absolute top-full left-0 right-0 z-20 mt-1 rounded-2xl border border-gray-200 bg-white overflow-hidden">
 {(productSuggestions[item.id]||[]).map(p=>(
 <button key={p.id} type="button"onMouseDown={()=>selectProduct(item.id,p)}
 className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50 border-b border-gray-50 last:border-0">
 <div><p className="text-sm font-medium text-gray-900">{p.name}</p>{p.description&&<p className="text-xs text-gray-400">{p.description}</p>}</div>
 <span className="text-xs font-semibold text-gray-600 ml-3 flex-shrink-0">{formatCents(p.price)}</span>
 </button>
 ))}
 </div>
 )}
 </div>
 <input type="text"value={item.description}
 onChange={e=>updateItem(item.id,'description',e.target.value)}
 placeholder={item.isSurcharge?'Credit card surcharge':'Optional note'}
 className={`w-full rounded-lg border px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none transition-colors ${item.isSurcharge?'border-gray-200 bg-gray-100 text-gray-600':'border-gray-200 text-gray-900 focus:border-gray-400'}`}/>
 <div className="relative w-full sm:w-auto">
 <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
 <input type="number"min="0"step="0.01"value={item.amount}
 onChange={e=>updateItem(item.id,'amount',e.target.value)}
 placeholder="0.00"
 className={`w-full rounded-lg border pl-6 pr-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none transition-colors ${item.isSurcharge?'border-gray-200 bg-gray-100 font-medium':'border-gray-200 focus:border-gray-400'}`}/>
 </div>
 <button type="button"onClick={()=>removeItem(item.id)}
 className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors flex-shrink-0">
 <Trash2 size={14}/>
 </button>
 </div>
 </div>
 ))}
 </div>
 {/* Footer */}
 <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50/50">
 <div className="flex items-center gap-3">
 <button type="button"onClick={addItem}
 className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
 <Plus size={14}/> Add Line Item
 </button>
 {!hasSurcharge() && (
 <button type="button"onClick={()=>setLineItems(p=>[...p,surcharge(subtotalCents)])}
 className="text-xs text-gray-400 hover:text-gray-700 transition-colors">+ 2.75% fee</button>
 )}
 </div>
 <div className="text-sm space-y-0.5 text-right">
 {hasSurcharge() && <div className="flex items-center gap-3 text-gray-400 text-xs"><span>Subtotal</span><span className="min-w-[70px]">{formatCents(subtotalCents)}</span></div>}
 <div className="flex items-center gap-3 font-bold text-gray-900"><span>Total</span><span className="min-w-[70px]">{formatCents(totalCents)}</span></div>
 </div>
 </div>
 </div>
 </div>

 {/* Payment Type */}
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="px-5 py-4 border-b border-gray-200">
 <p className="text-sm font-semibold text-gray-900">Payment Type</p>
 </div>
 <div className="px-5 py-4 space-y-4">
 <div className="flex flex-wrap gap-2">
 {([
 {key:'full', label:'Pay in Full'},
 {key:'installment',label:'Installments'},
 {key:'subscription',label:'Subscription'},
 ] as {key:PaymentType;label:string}[]).map(pt=>(
 <button key={pt.key} type="button"onClick={()=>setPaymentType(pt.key)}
 className={`rounded-2xl border-2 px-4 py-2 text-sm font-medium transition-all ${paymentType===pt.key?'border-gray-900 bg-gray-50 text-gray-900':'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
 {pt.label}
 </button>
 ))}
 </div>

 {paymentType==='installment' && (
 <div className="space-y-2">
 <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Installment Schedule</p>
 {installments.map(inst=>(
 <div key={inst.id} className="flex items-center gap-2">
 <div className="relative flex-1">
 <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
 <input type="number"min="0"step="0.01"value={inst.amount}
 onChange={e=>setInstallments(p=>p.map(i=>i.id===inst.id?{...i,amount:e.target.value}:i))}
 placeholder="0.00"className="w-full rounded-2xl border border-gray-200 pl-7 pr-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none"/>
 </div>
 <input type="date"min={today()} value={inst.date}
 onChange={e=>setInstallments(p=>p.map(i=>i.id===inst.id?{...i,date:e.target.value}:i))}
 className="rounded-2xl border border-gray-200 px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none"/>
 <button type="button"onClick={()=>setInstallments(p=>p.filter(i=>i.id!==inst.id))} className="text-gray-400 hover:text-red-500 transition-colors p-1.5"><Trash2 size={14}/></button>
 </div>
 ))}
 <button type="button"onClick={()=>setInstallments(p=>[...p,{id:uid(),amount:'',date:''}])}
 className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors">
 <Plus size={13}/> Add Payment
 </button>
 </div>
 )}

 {paymentType==='subscription' && (
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
 <div>
 <label className="block text-xs font-medium text-gray-500 mb-1.5">Amount / Period</label>
 <div className="relative">
 <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
 <input type="number"min="0"step="0.01"value={subAmount} onChange={e=>setSubAmount(e.target.value)} placeholder="0.00"className="w-full rounded-2xl border border-gray-200 pl-7 pr-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none"/>
 </div>
 </div>
 <div>
 <label className="block text-xs font-medium text-gray-500 mb-1.5">Frequency</label>
 <select value={subFrequency} onChange={e=>setSubFrequency(e.target.value)} className="w-full rounded-2xl border border-gray-200 px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none appearance-none">
 <option value="monthly">Monthly</option>
 <option value="weekly">Weekly</option>
 <option value="quarterly">Quarterly</option>
 <option value="yearly">Yearly</option>
 </select>
 </div>
 <div>
 <label className="block text-xs font-medium text-gray-500 mb-1.5">Start Date</label>
 <input type="date"min={today()} value={subStartDate} onChange={e=>setSubStartDate(e.target.value)} className="w-full rounded-2xl border border-gray-200 px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none"/>
 </div>
 </div>
 )}
 </div>
 </div>
 </div>

 {/* ── RIGHT: Live Preview (desktop always visible, mobile toggle) ── */}
 <div className={`lg:block lg:sticky lg:top-10 ${showPreview ? 'block' : 'hidden lg:block'}`}>
 <div className="rounded-2xl border border-gray-200 bg-white">
 <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
 <div className="flex items-center gap-2">
 <p className="text-sm font-semibold text-gray-900">Live Preview</p>
 <div className="flex items-center gap-1"><div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"/><span className="text-[10px] text-gray-400">live</span></div>
 </div>
 <button onClick={()=>setShowPreviewModal(true)}
 className="flex items-center gap-1.5 rounded-2xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
 <Eye size={12}/> Preview
 </button>
 </div>
 <div className="p-4">
 <LivePreview
 mode={mode} clientName={clientName} clientEmail={clientEmail}
 contractHtml={contractHtml} lineItems={lineItems}
 paymentType={paymentType} installments={installments}
 subAmount={subAmount} subFrequency={subFrequency}
 venueName={venueName} logoUrl={logoUrl} brandColor={brandColor}
 onPreview={() => setShowPreviewModal(true)}
 />
 </div>
 </div>
 </div>
 </div>

 {/* Full Preview Modal — true full-screen scrollable */}
 {showPreviewModal && (
 <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
 {/* Sticky top bar — never scrolls */}
 <div className="flex-shrink-0 flex items-center justify-between bg-white border-b border-gray-200 px-4 sm:px-6 py-3.5">
 <div>
 <p className="text-base font-bold text-gray-900">
 {mode === 'invoice' ? 'Invoice Preview' : 'Proposal Preview'}
 </p>
 <p className="text-xs text-gray-400">Exactly what your client will see</p>
 </div>
 <div className="flex items-center gap-2">
 <button onClick={()=>setShowPreviewModal(false)}
 className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
 Close
 </button>
 <button onClick={()=>{setShowPreviewModal(false);submit(false);}} disabled={submitting}
 className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-all"
 style={{backgroundColor:'#1b1b1b'}}>
 <Send size={14}/> {submitting?'Sending...':'Looks good, Send'}
 </button>
 </div>
 </div>

 {/* Scrollable content — flex-1 + overflow-y-auto = true scroll */}
 <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }} className="py-6 px-4 flex justify-center">
 <div className="w-full max-w-lg pb-8">
 {/* Full document preview */}
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 {/* Branded header */}
 <div className="px-6 py-5 flex items-center justify-between"style={{backgroundColor: brandColor||'#1b1b1b'}}>
 <div className="flex items-center gap-3">
 {logoUrl ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img src={logoUrl} alt="logo"className="h-10 object-contain"onError={e=>(e.currentTarget.style.display='none')}/>
 ) : (
 <>
 <div className="h-10 w-10 rounded-2xl bg-white/20 flex items-center justify-center text-white font-bold text-lg">{venueName?.charAt(0)||'V'}</div>
 <p className="text-white font-bold">{venueName||'Your Venue'}</p>
 </>
 )}
 </div>
 <div className="text-right">
 <p className="text-white font-bold text-xl">{mode==='invoice'?'INVOICE':'PROPOSAL'}</p>
 <p className="text-white/60 text-xs">#001</p>
 </div>
 </div>

 <div className="px-6 py-5 space-y-5">
 {/* Client */}
 <div>
 <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Bill To</p>
 <p className="font-bold text-gray-900 text-base">{clientName||'Client Name'}</p>
 {clientEmail && <p className="text-sm text-gray-500 mt-0.5">{clientEmail}</p>}
 {clientPhone && <p className="text-sm text-gray-500">{clientPhone}</p>}
 </div>

 {/* Contract */}
 {mode==='proposal' && contractHtml && (
 <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
 <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">Contract Terms</p>
 <div className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none"
 dangerouslySetInnerHTML={{__html:contractHtml}}/>
 </div>
 )}

 {/* Line items */}
 <div>
 <div className="rounded-2xl border border-gray-200 overflow-hidden">
 <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 grid grid-cols-[1fr_90px] text-[11px] font-bold uppercase tracking-wider text-gray-400">
 <span>Description</span><span className="text-right">Amount</span>
 </div>
 {lineItems.filter(i=>i.name||parseFloat(i.amount||'0')>0).map(item=>(
 <div key={item.id} className="px-4 py-3 grid grid-cols-[1fr_90px] border-b border-gray-50 last:border-0">
 <div>
 <p className={`text-sm ${item.isSurcharge?'text-gray-500':'text-gray-900 font-medium'}`}>{item.name||'Item'}</p>
 {item.description&&<p className="text-xs text-gray-400 mt-0.5">{item.description}</p>}
 </div>
 <p className="text-sm text-right font-medium text-gray-900">{formatCents(Math.round(parseFloat(item.amount||'0')*100))}</p>
 </div>
 ))}
 <div className="px-4 py-3 border-t-2 border-gray-200 grid grid-cols-[1fr_90px]">
 <p className="text-sm font-bold text-gray-900">Total</p>
 <p className="text-sm font-bold text-right text-gray-900">{formatCents(totalCents)}</p>
 </div>
 </div>
 </div>

 {/* Payment details */}
 {paymentType==='installment' && installments.filter(i=>i.amount&&i.date).length>0 && (
 <div>
 <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Installment Schedule</p>
 <div className="rounded-2xl border border-gray-200 overflow-hidden">
 {installments.filter(i=>i.amount&&i.date).map((inst,idx)=>(
 <div key={inst.id} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 last:border-0">
 <span className="text-sm text-gray-600">Payment {idx+1} — {inst.date}</span>
 <span className="text-sm font-semibold text-gray-900">{formatCents(Math.round(parseFloat(inst.amount||'0')*100))}</span>
 </div>
 ))}
 </div>
 </div>
 )}
 {paymentType==='subscription' && subAmount && (
 <div className="rounded-2xl border border-gray-200 px-4 py-3">
 <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Recurring Payment</p>
 <p className="text-sm text-gray-900"><span className="font-bold">{formatCents(Math.round(parseFloat(subAmount||'0')*100))}</span> / {subFrequency}{subStartDate&&` starting ${subStartDate}`}</p>
 </div>
 )}

 {/* CTA */}
 <button className="w-full rounded-xl py-3.5 text-sm font-bold text-white"style={{backgroundColor:brandColor||'#1b1b1b'}}>
 {mode==='invoice'?'Pay Now':'Review & Sign'}
 </button>
 <p className="text-[11px] text-gray-300 text-center">Powered by StoryPay</p>
 </div>
 </div>
 </div>
 </div>
 </div>
 )}

 {/* AI Generator Modal */}
 {showAI && (
 <AIProposalGenerator
 onGenerated={(html)=>{setContractHtml(html);setShowEditor(true);setShowAI(false);}}
 onClose={()=>setShowAI(false)}
 prefillClientName={clientName}
 />
 )}
 </div>
 );
}
