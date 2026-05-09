'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
 Send, Save, Plus, Trash2, Search, UserPlus, X, ChevronDown,
 FileText, Eye, EyeOff, Loader2, CheckCircle2, Sparkles, ArrowLeft,
 PenLine, Package, Tag, Percent, ChevronRight,
} from 'lucide-react';
import DOMPurify from 'isomorphic-dompurify';
import { formatCents } from '@/lib/utils';
import PaymentGate from '@/components/PaymentGate';
import dynamic from 'next/dynamic';
import {
  computeDiscountCents,
  canRedeemCoupon,
  type VenueCouponRow,
} from '@/lib/venue-coupons-logic';
import { formatInTimeZone } from 'date-fns-tz';
import { resolveVenueTimezone } from '@/lib/venue-timezone';

const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), { ssr: false });
const AIProposalGenerator = dynamic(() => import('@/components/AIProposalGenerator'), { ssr: false });

// ─── Constants ────────────────────────────────────────────────────────────────
const SURCHARGE_RATE = 0.0275;
const SURCHARGE_ID = '__surcharge__';
const COUPON_LINE_ID = '__coupon__';

// ─── Types ────────────────────────────────────────────────────────────────────
type Mode = 'proposal' | 'invoice';
type PaymentType = 'full' | 'installment' | 'subscription';

interface Customer { id: number; name: string; email: string; phone?: string; }
interface Template { id: string; name: string; content: string; }
interface LineItem {
  id: string;
  name: string;
  description: string;
  amount: string;
  isSurcharge?: boolean;
  isCoupon?: boolean;
  couponId?: string;
}
interface Installment { id: string; amount: string; date: string; }
interface Product { id: string; name: string; description: string | null; price: number; }

type PackageProductEmbed = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  active: boolean;
};

type VenuePackageLine = {
  product_id: string;
  quantity: number;
  price_override_cents: number | null;
  venue_products?: PackageProductEmbed | PackageProductEmbed[] | null;
};

type VenuePackageRow = {
  id: string;
  name: string;
  description: string | null;
  season_label: string | null;
  valid_from: string | null;
  valid_to: string | null;
  minimum_subtotal_cents: number;
  venue_package_lines: VenuePackageLine[];
};

function packageProduct(line: VenuePackageLine): PackageProductEmbed | null {
  const v = line.venue_products;
  const p = Array.isArray(v) ? v[0] : v;
  return p?.id ? p : null;
}

function packageAppliesToday(pkg: VenuePackageRow, tzRaw: string | null | undefined): boolean {
  const tz = resolveVenueTimezone(tzRaw);
  const ymd = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
  if (pkg.valid_from && ymd < pkg.valid_from) return false;
  if (pkg.valid_to && ymd > pkg.valid_to) return false;
  return true;
}

function uid() { return Math.random().toString(36).slice(2, 10); }
function today() {
 const d = new Date();
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function emptyItem(): LineItem { return { id: uid(), name: '', description: '', amount: '' }; }
function surcharge(subtotalCents: number): LineItem {
 return { id: SURCHARGE_ID, name: 'Processing Fee (2.75%)', description: 'Credit card processing surcharge', amount: ((subtotalCents * SURCHARGE_RATE) / 100).toFixed(2), isSurcharge: true };
}

function lineCents(amountStr: string): number {
  const v = parseFloat(amountStr || '0');
  return Number.isNaN(v) ? 0 : Math.round(v * 100);
}

function stripDerived(items: LineItem[]): LineItem[] {
  return items.filter((i) => !i.isCoupon && !i.isSurcharge);
}

function withDerivedFromCore(
  core: LineItem[],
  hasSurcharge: boolean,
  applied: string | null,
  couponList: VenueCouponRow[],
): LineItem[] {
  let rows = [...core];
  if (applied) {
    const c = couponList.find((x) => x.id === applied);
    if (c && c.active !== false) {
      const merchant = rows.reduce((s, i) => s + lineCents(i.amount), 0);
      const disc = computeDiscountCents(c as VenueCouponRow, merchant);
      rows.push({
        id: COUPON_LINE_ID,
        name: `Discount (${c.code})`,
        description: c.name || '',
        amount: disc > 0 ? (-disc / 100).toFixed(2) : '0.00',
        isCoupon: true,
        couponId: c.id,
      });
    }
  }
  const net = rows.reduce((s, i) => s + lineCents(i.amount), 0);
  if (hasSurcharge) {
    rows.push({
      id: SURCHARGE_ID,
      name: 'Processing Fee (2.75%)',
      description: 'Credit card processing surcharge',
      amount: ((net * SURCHARGE_RATE) / 100).toFixed(2),
      isSurcharge: true,
    });
  }
  return rows;
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
 <div className="text-xs text-gray-600 leading-relaxed"dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(contractHtml) }} />
 <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-50"/>
 </div>
 )}

 {/* Line items */}
 <div className="rounded-2xl border border-gray-200 overflow-hidden">
 <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 grid grid-cols-[1fr_80px] text-[10px] font-semibold uppercase tracking-wider text-gray-400">
 <span>Description</span><span className="text-right">Amount</span>
 </div>
 {lineItems.filter(i => i.name || i.isCoupon || parseFloat(i.amount||'0') !== 0).map(item => (
 <div key={item.id} className="px-3 py-2 grid grid-cols-[1fr_80px] border-b border-gray-50 last:border-0">
 <div>
 <p className={`text-xs ${item.isSurcharge ? 'text-gray-500' : item.isCoupon ? 'text-emerald-800 font-medium' : 'text-gray-800 font-medium'}`}>{item.name || 'Item'}</p>
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

 <p className="text-[10px] text-gray-300 text-center">Powered by StoryVenue</p>
 </div>
 </div>
 );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
function NewProposalInvoicePageInner() {
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
 const [venueCoupons, setVenueCoupons] = useState<VenueCouponRow[]>([]);
 const [appliedCouponId, setAppliedCouponId] = useState<string | null>(null);
 const [products, setProducts] = useState<Product[]>([]);
 const [packages, setPackages] = useState<VenuePackageRow[]>([]);
 const [venueTimezone, setVenueTimezone] = useState<string | null>(null);
 const [selectedPackageId, setSelectedPackageId] = useState<string>('');
 const [appliedPackage, setAppliedPackage] = useState<{
   id: string;
   name: string;
   minimum_subtotal_cents: number;
 } | null>(null);
 const [productSuggestions, setProductSuggestions] = useState<Record<string,Product[]>>({});
 const [showSuggestions, setShowSuggestions] = useState<Record<string,boolean>>({});
 const suggestTimers = useRef<Record<string,ReturnType<typeof setTimeout>>>({});
 // Inline line-item type picker (per-row dropdown)
 const [itemPickerId, setItemPickerId] = useState<string | null>(null);
 const [itemPickerMode, setItemPickerMode] = useState<'menu' | 'package' | 'coupon'>('menu');
 const [itemPickerPkgId, setItemPickerPkgId] = useState('');
 const [itemPickerCpnId, setItemPickerCpnId] = useState('');
 // Track rows where the user has already committed to manual typing
 const activatedItems = useRef<Set<string>>(new Set());
 // Refs for re-focusing inputs after picker closes
 const itemInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
 const addPickerRef = useRef<HTMLDivElement>(null);

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

 const leadIdParam = searchParams.get('leadId');
 useEffect(() => {
   if (!leadIdParam) return;
   let cancelled = false;
   void fetch(`/api/leads/${leadIdParam}`, { cache: 'no-store' })
     .then((r) => (r.ok ? r.json() : null))
     .then((d: { lead?: {
       first_name: string | null;
       last_name: string | null;
       name: string;
       email: string;
       phone: string | null;
     } } | null) => {
       if (cancelled || !d?.lead) return;
       const lead = d.lead;
       const fn = (lead.first_name || '').trim();
       const ln = (lead.last_name || '').trim();
       if (fn || ln) {
         setClientFirst(fn);
         setClientLast(ln);
       } else {
         const parts = (lead.name || '').trim().split(/\s+/);
         setClientFirst(parts[0] || '');
         setClientLast(parts.slice(1).join(' ') || '');
       }
       if (lead.email) setClientEmail(lead.email);
       if (lead.phone) setClientPhone(lead.phone);
       setCustomerMode('new');
     });
   return () => {
     cancelled = true;
   };
 }, [leadIdParam]);

 // Load templates + products + branding
 useEffect(() => {
 fetch('/api/templates').then(r=>r.json()).then(d=>setTemplates(Array.isArray(d)?d:[]));
 fetch('/api/products').then(r=>r.json()).then(d=>setProducts(Array.isArray(d)?d:[]));
 fetch('/api/venues/me').then(r=>r.json()).then(d=>{
 setVenueName(d.name||'');
 setLogoUrl(d.brand_logo_url||'');
 setVenueTimezone(typeof d.timezone === 'string' ? d.timezone : null);
 // Treat old default #293745 as unset — use #1b1b1b
 const c = d.brand_color;
 setBrandColor(c && c !== '#293745' && c !== '#354859' ? c : '#1b1b1b');
 });
 fetch('/api/venue-packages').then((r) => (r.ok ? r.json() : [])).then((d) => {
   setPackages(Array.isArray(d) ? d : []);
 });
 fetch('/api/venue-coupons')
   .then((r) => (r.ok ? r.json() : null))
   .then((d: { coupons?: VenueCouponRow[] } | null) => {
     setVenueCoupons(Array.isArray(d?.coupons) ? d!.coupons! : []);
   });
 }, []);

 // Escape key closes the inline picker
 useEffect(() => {
   if (!itemPickerId) return;
   function handler(e: KeyboardEvent) {
     if (e.key === 'Escape') { setItemPickerId(null); setItemPickerMode('menu'); }
   }
   document.addEventListener('keydown', handler);
   return () => document.removeEventListener('keydown', handler);
 }, [itemPickerId]);

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
 const subtotalCents = lineItems
   .filter((i) => !i.isSurcharge)
   .reduce((s, i) => s + lineCents(i.amount), 0);

 const totalCents = lineItems.reduce((s, i) => s + lineCents(i.amount), 0);

 function setCouponSelection(id: string | null) {
   setAppliedCouponId(id);
   setLineItems((prev) => {
     const hasSurcharge = prev.some((i) => i.isSurcharge);
     const core = stripDerived(prev);
     return withDerivedFromCore(core, hasSurcharge, id, venueCoupons);
   });
 }

 function updateItem(id: string, field: keyof LineItem, value: string) {
   setLineItems((prev) => {
     if (id === SURCHARGE_ID) {
       return prev.map((i) => (i.id === id ? { ...i, [field]: value } : i));
     }
     if (id === COUPON_LINE_ID) {
       return prev;
     }
     const hasSurcharge = prev.some((i) => i.isSurcharge);
     const core = stripDerived(prev).map((i) =>
       i.id === id ? { ...i, [field]: value } : i,
     );
     return withDerivedFromCore(core, hasSurcharge, appliedCouponId, venueCoupons);
   });
   if (field === 'name' && id !== SURCHARGE_ID && id !== COUPON_LINE_ID) {
     clearTimeout(suggestTimers.current[id]);
     suggestTimers.current[id] = setTimeout(() => {
       const filtered = products
         .filter((p) => p.name.toLowerCase().includes(value.toLowerCase()))
         .slice(0, 5);
       setProductSuggestions((prev) => ({ ...prev, [id]: filtered }));
       setShowSuggestions((prev) => ({
         ...prev,
         [id]: filtered.length > 0 && value.length > 0,
       }));
     }, 150);
   }
 }

 function removeItem(id: string) {
   if (id === COUPON_LINE_ID) {
     setAppliedCouponId(null);
   }
   setLineItems((prev) => {
     // If the user is deleting the surcharge row itself, drop the fee entirely.
     const hasSurcharge = id === SURCHARGE_ID ? false : prev.some((i) => i.isSurcharge);
     const core = stripDerived(prev).filter((i) => i.id !== id);
     const nextApplied = id === COUPON_LINE_ID ? null : appliedCouponId;
     return withDerivedFromCore(core, hasSurcharge, nextApplied, venueCoupons);
   });
 }

 function addItem() {
   const newItem = emptyItem();
   setLineItems((prev) => {
     const hasSurcharge = prev.some((i) => i.isSurcharge);
     const core = [...stripDerived(prev), newItem];
     return withDerivedFromCore(core, hasSurcharge, appliedCouponId, venueCoupons);
   });
   // New rows start fresh — picker will open on first focus
   activatedItems.current.delete(newItem.id);
   return newItem.id;
 }

 function selectProduct(itemId: string, p: Product) {
   setLineItems((prev) => {
     const hasSurcharge = prev.some((i) => i.isSurcharge);
     const core = stripDerived(prev).map((i) =>
       i.id === itemId
         ? {
             ...i,
             name: p.name,
             description: p.description || '',
             amount: (p.price / 100).toFixed(2),
           }
         : i,
     );
     return withDerivedFromCore(core, hasSurcharge, appliedCouponId, venueCoupons);
   });
   setShowSuggestions((prev) => ({ ...prev, [itemId]: false }));
 }

 function applySelectedPackage() {
   const pkg = packages.find((p) => p.id === selectedPackageId);
   if (!pkg) {
     setError('Select a package.');
     return;
   }
   if (!packageAppliesToday(pkg, venueTimezone)) {
     setError('This package is outside its valid date range.');
     return;
   }
   const hasSurchargeRow = lineItems.some((i) => i.isSurcharge);
   const core: LineItem[] = [];
   for (const line of pkg.venue_package_lines ?? []) {
     const p = packageProduct(line);
     if (!p || p.active === false) continue;
     const unitCents = line.price_override_cents ?? p.price;
     const totalCents = unitCents * Math.max(1, line.quantity || 1);
     core.push({
       id: uid(),
       name: line.quantity > 1 ? `${p.name} × ${line.quantity}` : p.name,
       description: p.description || '',
       amount: (totalCents / 100).toFixed(2),
     });
   }
   if (!core.length) {
     setError('This package has no active products.');
     return;
   }
   setAppliedPackage({
     id: pkg.id,
     name: pkg.name,
     minimum_subtotal_cents: pkg.minimum_subtotal_cents ?? 0,
   });
   setLineItems(withDerivedFromCore(core, hasSurchargeRow, appliedCouponId, venueCoupons));
   setError('');
 }

 function clearAppliedPackage() {
   setAppliedPackage(null);
 }

 function hasSurcharge() {
   return lineItems.some((i) => i.isSurcharge);
 }

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
 if (
   appliedPackage &&
   appliedPackage.minimum_subtotal_cents > 0 &&
   subtotalCents < appliedPackage.minimum_subtotal_cents
 ) {
   setError(
     `This package requires a minimum subtotal of ${formatCents(appliedPackage.minimum_subtotal_cents)} before sending (excluding processing fee).`,
   );
   return;
 }
 if (mode==='proposal' && !selectedTemplate && !contractHtml) {
   if (!asDraft) { setError('Please select or create a contract for this proposal.'); return; }
 }

 asDraft ? setSaving(true) : setSubmitting(true);

 try {
 const lineItemsPayload = lineItems.map((i) => ({
   name: i.name,
   description: i.description,
   amount: Math.round(parseFloat(i.amount || '0') * 100),
   ...(i.isCoupon ? { isCoupon: true, couponId: i.couponId } : {}),
   ...(i.isSurcharge ? { isSurcharge: true } : {}),
 }));

 let paymentConfig = {};
 if (paymentType==='installment') {
 paymentConfig = { installments: installments.map(i=>({ amount: Math.round(parseFloat(i.amount||'0')*100), date: i.date })) };
 } else if (paymentType==='subscription') {
 paymentConfig = { amount: Math.round(parseFloat(subAmount||'0')*100), frequency: subFrequency, start_date: subStartDate };
 }

 // Proposal mode: use proposals API (with or without template)
 if (mode==='proposal') {
 const res = await fetch('/api/proposals', {
 method: 'POST',
 headers: {'Content-Type':'application/json'},
 body: JSON.stringify({
 templateId: selectedTemplate?.id || undefined,
 customerName: clientName, customerEmail: clientEmail, customerPhone: clientPhone,
 lineItems: lineItemsPayload,
 appliedCouponId: appliedCouponId || undefined,
 price: totalCents, paymentType, paymentConfig, asDraft,
 // Always send the current contract content so AI-generated / freeform
 // contracts are captured even when no template is selected from the dropdown.
 overrideContent: contractHtml || undefined,
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
 appliedCouponId: appliedCouponId || undefined,
 paymentType, paymentConfig, asDraft,
 }),
 });
 if (!res.ok) { const d=await res.json(); setError(d.error||'Failed'); return; }
 router.push('/dashboard/payments/invoices');
 return;
 }

 router.push('/dashboard/payments/proposals');
 } catch { setError('Network error. Please try again.'); }
 finally { setSaving(false); setSubmitting(false); }
 }

 // ─────────────────────────────────────────────────────────────────────────
 const hasInteracted = clientName || clientEmail || totalCents > 0;

 return (
 <div>
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
 className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors whitespace-nowrap">
 <Eye size={14}/> Preview
 </button>
 <button onClick={()=>submit(true)} disabled={saving||submitting}
 className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors disabled:opacity-50 whitespace-nowrap">
 {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
 <span className="hidden sm:inline">{saving ? 'Saving...' : 'Save Draft'}</span>
 <span className="sm:hidden">{saving ? '...' : 'Draft'}</span>
 </button>
 <button onClick={()=>submit(false)} disabled={saving||submitting}
 className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-colors whitespace-nowrap"
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
 <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5">
 <div className="flex items-start justify-between gap-3">
 <div className="flex items-start gap-3 min-w-0">
 <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white border border-gray-200">
 <UserPlus size={14} className="text-gray-400" />
 </div>
 <div className="min-w-0">
 <p className="text-sm font-semibold text-gray-900 truncate">
 {clientFirst || clientLast
 ? `${clientFirst}${clientFirst && clientLast ? ' ' : ''}${clientLast}`.trim()
 : clientName || 'Selected contact'}
 </p>
 <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
 {clientEmail && (
 <div className="min-w-0">
 <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Email</p>
 <p className="text-gray-700 truncate">{clientEmail}</p>
 </div>
 )}
 {clientPhone && (
 <div className="min-w-0">
 <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Phone</p>
 <p className="text-gray-700 truncate">{clientPhone}</p>
 </div>
 )}
 {clientFirst && (
 <div className="min-w-0">
 <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">First name</p>
 <p className="text-gray-700 truncate">{clientFirst}</p>
 </div>
 )}
 {clientLast && (
 <div className="min-w-0">
 <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Last name</p>
 <p className="text-gray-700 truncate">{clientLast}</p>
 </div>
 )}
 </div>
 </div>
 </div>
 <button onClick={()=>{setSelectedCustomer(null);setClientFirst('');setClientLast('');setClientEmail('');setClientPhone('');setSearchQuery('');}}
 className="text-gray-400 hover:text-gray-600 shrink-0" aria-label="Clear selected contact"><X size={15}/></button>
 </div>
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
 <div className="text-xs text-gray-500 leading-relaxed"dangerouslySetInnerHTML={{__html:DOMPurify.sanitize(contractHtml)}}/>
 <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-gray-50"/>
 </div>
 )}
 </div>
 </div>
 )}

 {/* Line Items */}
 <div className="relative rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
   <p className="text-sm font-semibold text-gray-900">Line Items</p>
   <div className="flex items-center gap-3">
     {appliedCouponId && (
       <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
         <Tag size={10} />
         {venueCoupons.find(c => c.id === appliedCouponId)?.code ?? 'Coupon'}
         <button type="button" onClick={() => setCouponSelection(null)} className="ml-0.5 text-emerald-500 hover:text-emerald-800"><X size={10}/></button>
       </span>
     )}
     {appliedPackage && appliedPackage.minimum_subtotal_cents > 0 && (
       <span className={`text-xs ${subtotalCents < appliedPackage.minimum_subtotal_cents ? 'text-amber-700 font-medium' : 'text-gray-400'}`}>
         Min {formatCents(appliedPackage.minimum_subtotal_cents)}
       </span>
     )}
   </div>
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
 <div key={item.id} className={`px-5 py-3 ${item.isSurcharge?'bg-gray-50/60':''} ${item.isCoupon?'bg-emerald-50/40':''}`}>
 <div className="flex flex-col sm:grid sm:grid-cols-[1fr_180px_110px_36px] gap-2 sm:gap-3 items-start sm:items-center">
 {/* Name with inline type picker */}
 <div className="relative w-full">
 {item.isCoupon ? (
 <div className="w-full rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-sm font-medium text-emerald-900">
 {item.name}
 </div>
 ) : (
 <input type="text"value={item.name}
 ref={el => { itemInputRefs.current[item.id] = el; }}
 onChange={e=>{
   if (!activatedItems.current.has(item.id) && e.target.value !== '') {
     activatedItems.current.add(item.id);
     setItemPickerId(null);
     setItemPickerMode('menu');
   }
   updateItem(item.id,'name',e.target.value);
 }}
 onFocus={() => {
   if (!item.isSurcharge && !item.isCoupon && item.name === '' && !activatedItems.current.has(item.id)) {
     setItemPickerId(item.id);
     setItemPickerMode('menu');
     setItemPickerPkgId('');
     setItemPickerCpnId(appliedCouponId ?? '');
   }
 }}
 onBlur={()=>{
   setTimeout(()=>setShowSuggestions(p=>({...p,[item.id]:false})),150);
   // Only auto-close if picker is open for THIS item and user isn't interacting with picker
   setTimeout(()=>setItemPickerId(id=>id===item.id?null:id),300);
 }}
 placeholder={item.isSurcharge?'Processing Fee (2.75%)':`Item ${idx+1}`}
 className={`w-full rounded-lg border px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none transition-colors ${item.isSurcharge?'border-gray-200 bg-gray-100 text-gray-600 font-medium':'border-gray-200 text-gray-900 focus:border-gray-400'}`}/>
 )}
 {/* Autocomplete product suggestions */}
 {!item.isSurcharge && !item.isCoupon && showSuggestions[item.id] && (productSuggestions[item.id]||[]).length>0 && (
 <div className="absolute top-full left-0 right-0 z-30 mt-1 rounded-2xl border border-gray-200 bg-white shadow-lg overflow-hidden">
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
 {item.isCoupon ? (
 <p className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-xs text-emerald-800">{item.description || 'Discount'}</p>
 ) : (
 <input type="text"value={item.description}
 onChange={e=>updateItem(item.id,'description',e.target.value)}
 placeholder={item.isSurcharge?'Credit card surcharge':'Optional note'}
 className={`w-full rounded-lg border px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none transition-colors ${item.isSurcharge?'border-gray-200 bg-gray-100 text-gray-600':'border-gray-200 text-gray-900 focus:border-gray-400'}`}/>
 )}
 <div className="relative w-full sm:w-auto">
 {item.isCoupon ? (
 <div className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-right text-emerald-900">
 {formatCents(lineCents(item.amount))}
 </div>
 ) : (
 <>
 <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
 <input type="number"min="0"step="0.01"value={item.amount}
 onChange={e=>updateItem(item.id,'amount',e.target.value)}
 placeholder="0.00"
 className={`w-full rounded-lg border pl-6 pr-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none transition-colors ${item.isSurcharge?'border-gray-200 bg-gray-100 font-medium':'border-gray-200 focus:border-gray-400'}`}/>
 </>
 )}
 </div>
 <button type="button"onClick={()=>removeItem(item.id)}
 className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors flex-shrink-0">
 <Trash2 size={14}/>
 </button>
 </div>
 </div>
 ))}
 </div>
 {/* ── Full-card line item type picker ── */}
 {itemPickerId !== null && (
   <div className="absolute inset-0 z-30 flex flex-col justify-center rounded-2xl bg-white"
     onMouseDown={e => e.preventDefault()}
   >
     {itemPickerMode === 'menu' && (
       <div className="px-5 py-4">
         <div className="flex items-center justify-between mb-4">
           <p className="text-sm font-semibold text-gray-900">What type of line item?</p>
           <button type="button"
onMouseDown={e => { e.preventDefault(); setItemPickerId(null); setItemPickerMode('menu'); }}
            className="text-gray-400 hover:text-gray-700 transition-colors"><X size={15}/></button>
         </div>
         <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
           {/* Manual entry */}
           <button type="button"
             onMouseDown={e => { e.preventDefault(); const id = itemPickerId!; activatedItems.current.add(id); setItemPickerId(null); setItemPickerMode('menu'); setTimeout(() => itemInputRefs.current[id]?.focus(), 0); }}
             className="flex items-center gap-3 rounded-xl border-2 border-gray-100 bg-gray-50 px-4 py-3.5 text-left hover:border-gray-300 hover:bg-gray-100 transition-all cursor-pointer">
             <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-600 shadow-sm"><PenLine size={16}/></span>
             <div><p className="font-semibold text-gray-900">Manual entry</p><p className="text-xs text-gray-400 mt-0.5">Type a custom item &amp; price</p></div>
           </button>
           {/* Package */}
           {packages.filter(p => packageAppliesToday(p, venueTimezone)).length > 0 && (
             <button type="button"
               onMouseDown={e => { e.preventDefault(); setItemPickerMode('package'); setItemPickerPkgId(''); }}
               className="flex items-center gap-3 rounded-xl border-2 border-blue-100 bg-blue-50 px-4 py-3.5 text-left hover:border-blue-300 hover:bg-blue-100 transition-all cursor-pointer">
               <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white border border-blue-200 text-blue-600 shadow-sm"><Package size={16}/></span>
               <div><p className="font-semibold text-gray-900">From package</p><p className="text-xs text-gray-400 mt-0.5">Load lines from a saved package</p></div>
             </button>
           )}
           {/* Coupon */}
           {venueCoupons.filter(c => c.active && canRedeemCoupon(c as VenueCouponRow).ok).length > 0 && (
             <button type="button"
               onMouseDown={e => { e.preventDefault(); setItemPickerMode('coupon'); setItemPickerCpnId(appliedCouponId ?? ''); }}
               className="flex items-center gap-3 rounded-xl border-2 border-emerald-100 bg-emerald-50 px-4 py-3.5 text-left hover:border-emerald-300 hover:bg-emerald-100 transition-all cursor-pointer">
               <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white border border-emerald-200 text-emerald-600 shadow-sm"><Tag size={16}/></span>
               <div><p className="font-semibold text-gray-900">Apply coupon</p><p className="text-xs text-gray-400 mt-0.5">{appliedCouponId ? 'Change or remove discount' : 'Add a discount code'}</p></div>
             </button>
           )}
           {/* Processing fee */}
           {!hasSurcharge() && (
             <button type="button"
               onMouseDown={e => { e.preventDefault(); setLineItems(prev => { if (prev.some(i => i.isSurcharge)) return prev; return withDerivedFromCore(stripDerived(prev), true, appliedCouponId, venueCoupons); }); activatedItems.current.add(itemPickerId!); setItemPickerId(null); }}
               className="flex items-center gap-3 rounded-xl border-2 border-amber-100 bg-amber-50 px-4 py-3.5 text-left hover:border-amber-300 hover:bg-amber-100 transition-all cursor-pointer">
               <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white border border-amber-200 text-amber-600 shadow-sm"><Percent size={16}/></span>
               <div><p className="font-semibold text-gray-900">Processing fee</p><p className="text-xs text-gray-400 mt-0.5">Add 2.75% card surcharge</p></div>
             </button>
           )}
         </div>
       </div>
     )}
     {itemPickerMode === 'package' && (
       <div className="px-5 py-4 flex flex-col" style={{maxHeight:'calc(100% - 16px)'}}>
         <div className="flex items-center gap-2 mb-3 shrink-0">
           <button type="button" onMouseDown={e => { e.preventDefault(); setItemPickerMode('menu'); }} className="text-gray-400 hover:text-gray-700"><ChevronRight size={14} className="rotate-180"/></button>
           <p className="text-sm font-semibold text-gray-900 flex-1">Choose an item or bundle</p>
<button type="button" onMouseDown={e => { e.preventDefault(); setItemPickerId(null); setItemPickerMode('menu'); }} className="text-gray-400 hover:text-gray-700"><X size={14}/></button>
        </div>
        <div className="space-y-1.5 overflow-y-auto flex-1 pr-0.5">
           {/* Individual items */}
           {products.length > 0 && (
             <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-1 pt-1 pb-0.5">Items</p>
           )}
           {products.map(prod => (
             <button key={prod.id} type="button"
               onMouseDown={e => {
                 e.preventDefault();
                 const id = itemPickerId!;
                 activatedItems.current.add(id);
                 updateItem(id, 'name', prod.name);
                 updateItem(id, 'description', prod.description ?? '');
                 updateItem(id, 'amount', (prod.price / 100).toFixed(2));
                 setItemPickerId(null);
                 setItemPickerMode('menu');
               }}
               className="flex w-full items-center justify-between rounded-xl border-2 border-gray-100 bg-gray-50 px-4 py-3 text-left hover:border-blue-200 hover:bg-blue-50 transition-all"
             >
               <div>
                 <p className="font-semibold text-gray-900 text-sm">{prod.name}</p>
                 {prod.description && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[220px]">{prod.description}</p>}
               </div>
               <span className="text-sm font-semibold text-gray-700 ml-3 shrink-0">{formatCents(prod.price)}</span>
             </button>
           ))}
           {/* Bundles / packages */}
           {packages.filter(p => packageAppliesToday(p, venueTimezone)).length > 0 && (
             <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-1 pt-2 pb-0.5">Bundles</p>
           )}
           {packages.filter(p => packageAppliesToday(p, venueTimezone)).map(pkg => {
             const lineCount = (pkg.venue_package_lines ?? []).length;
             const totalCents = (pkg.venue_package_lines ?? []).reduce((sum, line) => {
               const prod = packageProduct(line);
               if (!prod) return sum;
               return sum + (line.price_override_cents ?? prod.price) * Math.max(1, line.quantity || 1);
             }, 0);
             return (
               <button key={pkg.id} type="button"
                 onMouseDown={e => {
                   e.preventDefault();
                   const hasSurchargeRow = lineItems.some(i => i.isSurcharge);
                   const core: LineItem[] = [];
                   for (const line of pkg.venue_package_lines ?? []) {
                     const p = packageProduct(line);
                     if (!p || p.active === false) continue;
                     const unitCents = line.price_override_cents ?? p.price;
                     const totalCents2 = unitCents * Math.max(1, line.quantity || 1);
                     core.push({ id: uid(), name: line.quantity > 1 ? `${p.name} × ${line.quantity}` : p.name, description: p.description || '', amount: (totalCents2 / 100).toFixed(2) });
                   }
                   if (!core.length) { setError('This package has no active products.'); setItemPickerId(null); return; }
                   setAppliedPackage({ id: pkg.id, name: pkg.name, minimum_subtotal_cents: pkg.minimum_subtotal_cents ?? 0 });
                   setLineItems(withDerivedFromCore(core, hasSurchargeRow, appliedCouponId, venueCoupons));
                   setError('');
                   setItemPickerId(null);
                   setItemPickerMode('menu');
                 }}
                 className="flex w-full items-center justify-between rounded-xl border-2 border-gray-100 bg-gray-50 px-4 py-3 text-left hover:border-blue-200 hover:bg-blue-50 transition-all"
               >
                 <div>
                   <p className="font-semibold text-gray-900 text-sm">{pkg.name}</p>
                   <p className="text-xs text-gray-400 mt-0.5">{lineCount} item{lineCount !== 1 ? 's' : ''}{pkg.season_label ? ` · ${pkg.season_label}` : ''}</p>
                 </div>
                 <span className="text-sm font-semibold text-gray-700 ml-3 shrink-0">{formatCents(totalCents)}</span>
               </button>
             );
           })}
           {products.length === 0 && packages.filter(p => packageAppliesToday(p, venueTimezone)).length === 0 && (
             <p className="text-sm text-gray-400 text-center py-6">No items or bundles found.</p>
           )}
         </div>
       </div>
     )}
     {itemPickerMode === 'coupon' && (
       <div className="px-5 py-4">
         <div className="flex items-center gap-2 mb-3">
           <button type="button" onMouseDown={e => { e.preventDefault(); setItemPickerMode('menu'); }} className="text-gray-400 hover:text-gray-700"><ChevronRight size={14} className="rotate-180"/></button>
           <p className="text-sm font-semibold text-gray-900 flex-1">Apply a coupon</p>
<button type="button" onMouseDown={e => { e.preventDefault(); setItemPickerId(null); setItemPickerMode('menu'); }} className="text-gray-400 hover:text-gray-700"><X size={14}/></button>
        </div>
        <div className="space-y-1.5 max-h-56 overflow-y-auto">
           {appliedCouponId && (
             <button type="button"
               onMouseDown={e => { e.preventDefault(); setCouponSelection(null); activatedItems.current.add(itemPickerId!); setItemPickerId(null); setItemPickerMode('menu'); }}
               className="flex w-full items-center gap-3 rounded-xl border-2 border-red-100 bg-red-50 px-4 py-3 text-left hover:border-red-300 hover:bg-red-100 transition-all">
               <X size={14} className="text-red-500 shrink-0"/>
               <span className="text-sm font-semibold text-red-700">Remove current discount</span>
             </button>
           )}
           {venueCoupons.filter(c => c.active).map(c => {
             const ok = canRedeemCoupon(c as VenueCouponRow).ok;
             const label = c.discount_type === 'percent' ? `${Number(c.discount_percent)}% off` : `$${((c.discount_amount_cents ?? 0) / 100).toFixed(2)} off`;
             const isApplied = c.id === appliedCouponId;
             return (
               <button key={c.id} type="button"
                 onMouseDown={e => {
                   e.preventDefault();
                   if (!ok) return;
                   setCouponSelection(c.id);
                   activatedItems.current.add(itemPickerId!);
                   setItemPickerId(null);
                   setItemPickerMode('menu');
                 }}
                 disabled={!ok}
                 className={`flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-left transition-all disabled:opacity-40 ${isApplied ? 'border-emerald-300 bg-emerald-50' : 'border-gray-100 bg-gray-50 hover:border-emerald-200 hover:bg-emerald-50'}`}
               >
                 <div>
                   <p className="font-semibold text-gray-900 text-sm">{c.code}</p>
                   <p className="text-xs text-gray-400 mt-0.5">{c.name}{!ok ? ' · unavailable' : ''}</p>
                 </div>
                 <span className={`text-sm font-bold shrink-0 ml-3 ${isApplied ? 'text-emerald-600' : 'text-gray-700'}`}>{label}</span>
               </button>
             );
           })}
         </div>
       </div>
     )}
   </div>
 )}

 {/* Footer */}
 <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50/50">
 <button
   type="button"
   onClick={() => addItem()}
   className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
 >
   <Plus size={14}/> Add Line Item
 </button>
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
 dangerouslySetInnerHTML={{__html:DOMPurify.sanitize(contractHtml)}}/>
 </div>
 )}

 {/* Line items */}
 <div>
 <div className="rounded-2xl border border-gray-200 overflow-hidden">
 <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 grid grid-cols-[1fr_90px] text-[11px] font-bold uppercase tracking-wider text-gray-400">
 <span>Description</span><span className="text-right">Amount</span>
 </div>
 {lineItems.filter(i=>i.name||i.isCoupon||parseFloat(i.amount||'0')!==0).map(item=>(
 <div key={item.id} className="px-4 py-3 grid grid-cols-[1fr_90px] border-b border-gray-50 last:border-0">
 <div>
 <p className={`text-sm ${item.isSurcharge?'text-gray-500':item.isCoupon?'text-emerald-800 font-medium':'text-gray-900 font-medium'}`}>{item.name||'Item'}</p>
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
 <p className="text-[11px] text-gray-300 text-center">Powered by StoryVenue</p>
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

export default function NewProposalInvoicePage() {
  return (
    <PaymentGate>
      <NewProposalInvoicePageInner />
    </PaymentGate>
  );
}
