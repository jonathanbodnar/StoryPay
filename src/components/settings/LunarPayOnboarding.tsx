'use client';

/**
 * LunarPayOnboarding
 *
 * Self-contained multi-step wizard that walks a venue owner through applying
 * for a StoryPay (LunarPay) merchant account.
 *
 * Steps:
 *   0 — Welcome / explainer
 *   1 — Business info  (name, contact)
 *   2 — Processing details  (address, banking, volume)
 *   3 — Sign the Fortis MPA (iframe embed from LunarPay)
 *   4 — Pending review (auto-polls every 30 s)
 *   5 — Active ✓
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Building2,
  Landmark,
  FileText,
  Clock,
  ChevronRight,
  ChevronLeft,
  Loader2,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  BadgeCheck,
} from 'lucide-react';

// ── Volume range helpers ──────────────────────────────────────────────────────
const VOLUME_RANGES = [
  { value: 1, label: 'Up to $5,000 / mo' },
  { value: 2, label: '$5,001 – $10,000 / mo' },
  { value: 3, label: '$10,001 – $25,000 / mo' },
  { value: 4, label: '$25,001 – $50,000 / mo' },
  { value: 5, label: '$50,001 – $100,000 / mo' },
  { value: 6, label: '$100,001 – $250,000 / mo' },
  { value: 7, label: '$250,001+ / mo' },
];
const AVG_TICKET_RANGES = [
  { value: 1, label: 'Up to $15' },
  { value: 2, label: '$16 – $25' },
  { value: 3, label: '$26 – $50' },
  { value: 4, label: '$51 – $100' },
  { value: 5, label: '$101 – $200' },
  { value: 6, label: '$201 – $500' },
  { value: 7, label: '$500+' },
];

// ── Types ─────────────────────────────────────────────────────────────────────
interface LunarPayStatus {
  status: string;
  isActive: boolean;
  merchantId?: number;
  orgToken?: string;
  mpaEmbedUrl?: string;
}

interface Props {
  /** Called when the venue becomes active so the parent can refresh venue data */
  onActivated?: () => void;
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function Field({
  label, value, onChange, placeholder, type = 'text', required, hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean; hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
      />
      {hint && <p className="mt-1 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}

function Select({
  label, value, onChange, options, required,
}: {
  label: string; value: number; onChange: (v: number) => void;
  options: { value: number; label: string }[]; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LunarPayOnboarding({ onActivated }: Props) {
  const [lpStatus, setLpStatus] = useState<LunarPayStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [step, setStep] = useState(0); // 0=welcome,1=biz,2=banking,3=mpa,4=pending,5=active
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1 fields
  const [s1, setS1] = useState({
    firstName: '', lastName: '', phone: '', businessName: '',
  });

  // Step 2 fields
  const [s2, setS2] = useState({
    dbaName: '', legalName: '',
    addressLine1: '', city: '', state: '', postalCode: '',
    routingNumber: '', accountNumber: '', accountHolderName: '',
    ccMonthlyVolumeRange: 3, ccAverageTicketRange: 3, ccHighTicket: '5000',
    ecMonthlyVolumeRange: 2, ecAverageTicketRange: 2, ecHighTicket: '3000',
    email: '',
  });

  const [mpaEmbedUrl, setMpaEmbedUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep a stable ref to onActivated so fetchStatus never needs it as a
  // dependency. Without this, an inline `() => loadVenue()` prop creates a
  // new reference on every parent render, which recreates fetchStatus, which
  // fires the useEffect below again, causing an infinite status-polling loop
  // when the merchant account is already active.
  const onActivatedRef = useRef(onActivated);
  useEffect(() => { onActivatedRef.current = onActivated; }, [onActivated]);

  // ── Fetch live status ────────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/lunarpay/status', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json() as LunarPayStatus;
      setLpStatus(data);

      if (data.isActive) {
        setStep(5);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        onActivatedRef.current?.();
      } else if (data.status === 'not_started' || data.status === 'not_registered') {
        // No LunarPay merchant on file — show the welcome screen.
        setStep(0);
      } else if (data.status === 'registered') {
        // Merchant created, but Step 2 (banking/MPA) hasn't been submitted.
        setStep(2);
        if (data.mpaEmbedUrl) setMpaEmbedUrl(data.mpaEmbedUrl);
      } else if (['bank_information_sent','under_review','pending_review','pending'].includes(data.status ?? '')) {
        // Application is in flight — Fortis has the paperwork.
        setStep(4);
        if (data.mpaEmbedUrl) setMpaEmbedUrl(data.mpaEmbedUrl);
      } else if (data.status === 'denied') {
        // Keep them on the welcome screen; the support team handles denials
        // manually. (We don't expose a denial UI in the wizard.)
        setStep(0);
      } else if (data.status === 'active') {
        setStep(5);
      }
    } finally {
      setLoadingStatus(false);
    }
  }, []); // stable — reads onActivated via ref, no prop dependency

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Poll every 30 s while in pending state
  useEffect(() => {
    if (step === 4) {
      pollRef.current = setInterval(() => void fetchStatus(), 30_000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, fetchStatus]);

  // ── Step handlers ────────────────────────────────────────────────────────────
  async function handleRegister() {
    setError('');
    if (!s1.firstName.trim() || !s1.lastName.trim() || !s1.businessName.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/lunarpay/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s1),
      });
      const data = await res.json() as { error?: string; merchantId?: number; alreadyRegistered?: boolean };
      if (!res.ok) { setError(data.error ?? 'Registration failed.'); return; }
      setStep(2);
    } finally {
      setSaving(false);
    }
  }

  async function handleOnboard() {
    setError('');
    const required = ['dbaName','legalName','addressLine1','city','state','postalCode',
                      'routingNumber','accountNumber','accountHolderName','email'] as const;
    for (const k of required) {
      if (!s2[k].toString().trim()) { setError(`"${k}" is required.`); return; }
    }
    setSaving(true);
    try {
      const payload = {
        firstName:             s1.firstName || s2.accountHolderName.split(' ')[0] || '',
        lastName:              s1.lastName  || s2.accountHolderName.split(' ').slice(1).join(' ') || '',
        phone:                 s1.phone,
        email:                 s2.email,
        dbaName:               s2.dbaName,
        legalName:             s2.legalName,
        addressLine1:          s2.addressLine1,
        city:                  s2.city,
        state:                 s2.state,
        postalCode:            s2.postalCode,
        routingNumber:         s2.routingNumber,
        accountNumber:         s2.accountNumber,
        accountHolderName:     s2.accountHolderName,
        ccMonthlyVolumeRange:  s2.ccMonthlyVolumeRange,
        ccAverageTicketRange:  s2.ccAverageTicketRange,
        ccHighTicket:          Number(s2.ccHighTicket) || 5000,
        ecMonthlyVolumeRange:  s2.ecMonthlyVolumeRange,
        ecAverageTicketRange:  s2.ecAverageTicketRange,
        ecHighTicket:          Number(s2.ecHighTicket) || 3000,
      };
      const res = await fetch('/api/lunarpay/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { error?: string; mpaEmbedUrl?: string };
      if (!res.ok) { setError(data.error ?? 'Submission failed.'); return; }
      if (data.mpaEmbedUrl) setMpaEmbedUrl(data.mpaEmbedUrl);
      setStep(3);
    } finally {
      setSaving(false);
    }
  }

  function handleMpaComplete() {
    setStep(4);
    void fetchStatus();
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loadingStatus) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" /> Loading payment setup…
      </div>
    );
  }

  // ── Step 5: ACTIVE ────────────────────────────────────────────────────────────
  if (step === 5) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <BadgeCheck size={22} className="mt-0.5 shrink-0 text-emerald-600" />
        <div>
          <p className="font-semibold text-emerald-800">Payments active</p>
          <p className="mt-0.5 text-sm text-emerald-700">
            Your merchant account is approved and ready. You can send proposals, collect deposits,
            and process payments directly through StoryPay™.
          </p>
          {lpStatus?.merchantId && (
            <p className="mt-2 text-xs text-emerald-600">Merchant ID: {lpStatus.merchantId}</p>
          )}
        </div>
      </div>
    );
  }

  // ── Step 4: PENDING ───────────────────────────────────────────────────────────
  if (step === 4) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <Clock size={20} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-amber-800">Application under review</p>
            <p className="mt-1 text-sm text-amber-700">
              Fortis is reviewing your application. This typically takes <strong>24–48 hours</strong>.
              You'll be notified by email when your account is approved — or you can check back here.
            </p>
          </div>
        </div>
        {mpaEmbedUrl && (
          <div>
            <p className="mb-2 text-xs text-gray-500 font-medium">
              If you haven't yet signed the Merchant Processing Agreement, complete it below:
            </p>
            <iframe
              src={mpaEmbedUrl}
              className="h-[500px] w-full rounded-xl border border-gray-200"
              title="Fortis Merchant Processing Agreement"
            />
          </div>
        )}
        <button
          onClick={() => void fetchStatus()}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw size={14} /> Check status
        </button>
      </div>
    );
  }

  // ── Step 3: MPA IFRAME ────────────────────────────────────────────────────────
  if (step === 3) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
          <FileText size={18} className="mt-0.5 shrink-0 text-indigo-600" />
          <div>
            <p className="font-semibold text-indigo-800 text-sm">One last step — sign your Merchant Agreement</p>
            <p className="mt-0.5 text-xs text-indigo-700">
              Complete the Fortis Merchant Processing Agreement below. This authorises your account
              to process credit cards and ACH payments. It takes about 2 minutes.
            </p>
          </div>
        </div>
        {mpaEmbedUrl ? (
          <iframe
            src={mpaEmbedUrl}
            className="h-[540px] w-full rounded-xl border border-gray-200"
            title="Fortis Merchant Processing Agreement"
          />
        ) : (
          <p className="text-sm text-gray-500">Loading agreement form…</p>
        )}
        <div className="flex justify-between">
          <button onClick={() => setStep(2)} className="text-xs text-gray-400 hover:text-gray-600">
            ← Back
          </button>
          <button
            onClick={handleMpaComplete}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            I've signed the agreement <ChevronRight size={15} />
          </button>
        </div>
      </div>
    );
  }

  // ── Step 2: BANKING + VOLUME ──────────────────────────────────────────────────
  if (step === 2) {
    return (
      <div className="space-y-6">
        {/* Progress */}
        <StepProgress current={2} />

        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center gap-2 mb-4">
            <Landmark size={16} className="text-indigo-600" />
            <h3 className="font-semibold text-sm text-gray-900">Banking & Processing Details</h3>
          </div>
          <p className="text-xs text-gray-500 mb-5">
            Funds from your clients' payments will be deposited into the bank account below.
            Your card and ACH volume estimates help Fortis configure your limits.
          </p>

          <div className="space-y-4">
            {/* Business identity */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="DBA Name" value={s2.dbaName} onChange={(v) => setS2(p=>({...p,dbaName:v}))}
                placeholder="The Grand Ballroom" required />
              <Field label="Legal Name" value={s2.legalName} onChange={(v) => setS2(p=>({...p,legalName:v}))}
                placeholder="Grand Ballroom LLC" required />
            </div>
            <Field label="Contact Email" value={s2.email} onChange={(v) => setS2(p=>({...p,email:v}))}
              type="email" placeholder="billing@yourvenue.com" required />

            {/* Address */}
            <div className="pt-2 border-t border-gray-200">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Business Address</p>
              <div className="space-y-3">
                <Field label="Street Address" value={s2.addressLine1} onChange={(v) => setS2(p=>({...p,addressLine1:v}))}
                  placeholder="123 Main St" required />
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1">
                    <Field label="City" value={s2.city} onChange={(v) => setS2(p=>({...p,city:v}))} required />
                  </div>
                  <div>
                    <Field label="State" value={s2.state} onChange={(v) => setS2(p=>({...p,state:v}))}
                      placeholder="TX" required />
                  </div>
                  <div>
                    <Field label="ZIP" value={s2.postalCode} onChange={(v) => setS2(p=>({...p,postalCode:v}))}
                      placeholder="78701" required />
                  </div>
                </div>
              </div>
            </div>

            {/* Bank account */}
            <div className="pt-2 border-t border-gray-200">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Bank Account (for deposits)</p>
              <p className="text-[11px] text-gray-400 mb-3">
                This information is transmitted securely to Fortis and is never stored on StoryPay™ servers.
              </p>
              <div className="space-y-3">
                <Field label="Account Holder Name" value={s2.accountHolderName}
                  onChange={(v) => setS2(p=>({...p,accountHolderName:v}))} required />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Routing Number" value={s2.routingNumber}
                    onChange={(v) => setS2(p=>({...p,routingNumber:v}))} required
                    hint="9 digits (bottom-left of check)" />
                  <Field label="Account Number" value={s2.accountNumber}
                    onChange={(v) => setS2(p=>({...p,accountNumber:v}))} required />
                </div>
              </div>
            </div>

            {/* Volume estimates — Credit Card */}
            <div className="pt-2 border-t border-gray-200">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                Credit / Debit Card Volume Estimates
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Select label="Monthly Volume" value={s2.ccMonthlyVolumeRange}
                  onChange={(v) => setS2(p=>({...p,ccMonthlyVolumeRange:v}))} options={VOLUME_RANGES} required />
                <Select label="Average Ticket" value={s2.ccAverageTicketRange}
                  onChange={(v) => setS2(p=>({...p,ccAverageTicketRange:v}))} options={AVG_TICKET_RANGES} required />
              </div>
              <div className="mt-3">
                <Field label="Highest Single Transaction ($)" value={s2.ccHighTicket}
                  onChange={(v) => setS2(p=>({...p,ccHighTicket:v}))} type="number"
                  placeholder="5000" hint="Maximum single charge amount" />
              </div>
            </div>

            {/* Volume estimates — ACH */}
            <div className="pt-2 border-t border-gray-200">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                ACH / eCheck Volume Estimates
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Select label="Monthly Volume" value={s2.ecMonthlyVolumeRange}
                  onChange={(v) => setS2(p=>({...p,ecMonthlyVolumeRange:v}))} options={VOLUME_RANGES} required />
                <Select label="Average Ticket" value={s2.ecAverageTicketRange}
                  onChange={(v) => setS2(p=>({...p,ecAverageTicketRange:v}))} options={AVG_TICKET_RANGES} required />
              </div>
              <div className="mt-3">
                <Field label="Highest Single ACH ($)" value={s2.ecHighTicket}
                  onChange={(v) => setS2(p=>({...p,ecHighTicket:v}))} type="number"
                  placeholder="3000" />
              </div>
            </div>
          </div>
        </div>

        {error && (
          <p className="flex items-center gap-1.5 text-sm text-red-600">
            <AlertCircle size={14} /> {error}
          </p>
        )}

        <div className="flex items-center justify-between">
          {step === 2 && s1.firstName ? (
            <button onClick={() => setStep(1)} className="text-xs text-gray-400 hover:text-gray-600">
              ← Back
            </button>
          ) : <span />}
          <button
            onClick={() => void handleOnboard()}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <ChevronRight size={15} />}
            {saving ? 'Submitting…' : 'Submit & Sign Agreement'}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 1: BUSINESS INFO ─────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="space-y-6">
        <StepProgress current={1} />

        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={16} className="text-indigo-600" />
            <h3 className="font-semibold text-sm text-gray-900">Business Contact</h3>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First Name" value={s1.firstName} onChange={(v) => setS1(p=>({...p,firstName:v}))} required />
              <Field label="Last Name"  value={s1.lastName}  onChange={(v) => setS1(p=>({...p,lastName:v}))}  required />
            </div>
            <Field label="Phone" value={s1.phone} onChange={(v) => setS1(p=>({...p,phone:v}))}
              placeholder="555-123-4567" type="tel" />
            <Field label="Business Name" value={s1.businessName} onChange={(v) => setS1(p=>({...p,businessName:v}))}
              placeholder="Sunset Gardens Venue" required
              hint="The name clients will see on their receipts and statements." />
          </div>
        </div>

        {error && (
          <p className="flex items-center gap-1.5 text-sm text-red-600">
            <AlertCircle size={14} /> {error}
          </p>
        )}

        <div className="flex items-center justify-between">
          <button onClick={() => setStep(0)} className="text-xs text-gray-400 hover:text-gray-600">
            ← Back
          </button>
          <button
            onClick={() => void handleRegister()}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            {saving ? 'Saving…' : 'Next — Banking Details'}
            {!saving && <ChevronRight size={15} />}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 0: WELCOME ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600">
            <CreditCard size={20} className="text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Signup for StoryPay™ Payments</h3>
            <p className="text-xs text-gray-500">Powered by StoryPay&apos;s merchant platform · PCI-compliant</p>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-5">
          Accept credit cards and bank transfers directly through StoryPay™. Send proposals, collect
          deposits, and run payment schedules — all without leaving the platform.
        </p>

        {/* Free for venue owners — highlighted as top feature */}
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <BadgeCheck size={20} className="shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-bold text-emerald-800">Free for Venue Owners — 0% Processing Fees</p>
            <p className="text-xs text-emerald-700">Keep 100% of every payment. No monthly fees, no hidden charges.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mb-6">
          {[
            { icon: ShieldCheck, title: 'PCI-Compliant', desc: 'Card data never touches your servers' },
            { icon: CreditCard,  title: 'Cards + ACH',   desc: 'Credit, debit & bank transfers' },
            { icon: Clock,       title: '24–48h Approval', desc: 'Typical Fortis review time' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-2 rounded-xl border border-indigo-100 bg-white p-3">
              <Icon size={16} className="mt-0.5 shrink-0 text-indigo-500" />
              <div>
                <p className="text-xs font-semibold text-gray-800">{title}</p>
                <p className="text-[11px] text-gray-500">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">How it works</p>
          <ol className="space-y-2">
            {[
              'Enter your business & contact info',
              'Provide banking details for fund deposits',
              'Sign the Fortis Merchant Processing Agreement',
              'Fortis reviews your application (24–48 h)',
              "You're approved and can start processing payments",
            ].map((text, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-bold text-indigo-700">
                  {i + 1}
                </span>
                {text}
              </li>
            ))}
          </ol>
        </div>

        <button
          onClick={() => setStep(1)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          Get Started <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Progress indicator ────────────────────────────────────────────────────────
function StepProgress({ current }: { current: number }) {
  const steps = ['Business Info', 'Banking & Volume', 'Sign Agreement'];
  return (
    <div className="flex items-center gap-1">
      {steps.map((label, i) => {
        const idx = i + 1;
        const done = current > idx;
        const active = current === idx;
        return (
          <div key={label} className="flex flex-1 items-center gap-1">
            <div className={[
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
              done   ? 'bg-indigo-600 text-white' :
              active ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-400' :
                       'bg-gray-100 text-gray-400',
            ].join(' ')}>
              {done ? <CheckCircle2 size={12} /> : idx}
            </div>
            <span className={['text-[11px] font-medium truncate', active ? 'text-indigo-700' : 'text-gray-400'].join(' ')}>
              {label}
            </span>
            {i < steps.length - 1 && <div className="flex-1 h-px bg-gray-200 mx-1" />}
          </div>
        );
      })}
    </div>
  );
}
