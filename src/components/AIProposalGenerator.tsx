'use client';

import { useState } from 'react';
import { X, Sparkles, Loader2, ChevronDown } from 'lucide-react';

interface AIProposalGeneratorProps {
  onGenerated: (html: string) => void;
  onClose: () => void;
  prefillClientName?: string;
}

const BRAND = '#1b1b1b';

const INPUT_CLASS = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:bg-white transition-colors';
const LABEL_CLASS = 'block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide';

export default function AIProposalGenerator({ onGenerated, onClose, prefillClientName = '' }: AIProposalGeneratorProps) {
  const [form, setForm] = useState({
    clientName: prefillClientName,
    eventDate: '',
    guestCount: '',
    packageName: '',
    packagePrice: '',
    venueSpaces: '',
    includedServices: '',
    paymentType: 'full',
    depositAmount: '',
    specialNotes: '',
    tone: 'professional',
  });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'form' | 'generating' | 'done'>('form');

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.clientName.trim()) { setError('Client name is required'); return; }
    setError('');
    setGenerating(true);
    setStep('generating');

    try {
      const res = await fetch('/api/ai/proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Generation failed. Please try again.');
        setStep('form');
        return;
      }
      setStep('done');
      onGenerated(data.html);
    } catch {
      setError('Network error. Please try again.');
      setStep('form');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl rounded-3xl bg-white overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-gray-100" style={{ backgroundColor: BRAND }}>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
              <Sparkles size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">AI Proposal Generator</h2>
              <p className="text-xs text-white/60 mt-0.5">Fill in the details and AI will write the full proposal</p>
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors">
            <X size={15} />
          </button>
        </div>

        {step === 'generating' ? (
          /* Generating state */
          <div className="flex flex-col items-center justify-center gap-5 px-8 py-16">
            <div className="relative">
              <div className="h-16 w-16 rounded-full border-4 border-gray-100 flex items-center justify-center" style={{ borderTopColor: BRAND }}>
                <Loader2 size={28} className="animate-spin" style={{ color: BRAND }} />
              </div>
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-gray-900 mb-1">Writing your proposal...</p>
              <p className="text-sm text-gray-400">AI is crafting a personalized proposal for {form.clientName}</p>
            </div>
            <div className="flex gap-1.5">
              {['Analyzing details', 'Writing content', 'Formatting proposal'].map((s, i) => (
                <div key={s} className="flex items-center gap-1.5 rounded-full bg-gray-50 border border-gray-200 px-3 py-1">
                  <div className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ backgroundColor: BRAND, animationDelay: `${i * 0.3}s` }} />
                  <span className="text-[11px] text-gray-500 font-medium">{s}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Form */
          <form onSubmit={generate} className="flex-1 overflow-y-auto">
            <div className="px-7 py-6 space-y-5">

              {/* Client info */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-5 w-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: BRAND }}>1</div>
                  <span className="text-sm font-semibold text-gray-700">Client Details</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-7">
                  <div>
                    <label className={LABEL_CLASS}>Client Name <span className="text-red-400">*</span></label>
                    <input type="text" value={form.clientName} onChange={upd('clientName')} placeholder="Jane & John Smith" className={INPUT_CLASS} required />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Event Date</label>
                    <input type="date" value={form.eventDate} onChange={upd('eventDate')} className={INPUT_CLASS} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Guest Count</label>
                    <input type="number" value={form.guestCount} onChange={upd('guestCount')} placeholder="150" className={INPUT_CLASS} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Venue Spaces</label>
                    <input type="text" value={form.venueSpaces} onChange={upd('venueSpaces')} placeholder="Grand Ballroom, Garden Patio" className={INPUT_CLASS} />
                  </div>
                </div>
              </div>

              <hr className="border-gray-100" />

              {/* Package info */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-5 w-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: BRAND }}>2</div>
                  <span className="text-sm font-semibold text-gray-700">Package Details</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-7">
                  <div>
                    <label className={LABEL_CLASS}>Package Name</label>
                    <input type="text" value={form.packageName} onChange={upd('packageName')} placeholder="All-Inclusive Wedding Package" className={INPUT_CLASS} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Package Price ($)</label>
                    <input type="number" value={form.packagePrice} onChange={upd('packagePrice')} placeholder="8500" className={INPUT_CLASS} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={LABEL_CLASS}>What's Included</label>
                    <textarea value={form.includedServices} onChange={upd('includedServices')} placeholder="Tables & chairs, linens, catering kitchen access, bridal suite, 12-hour venue access, setup/cleanup..." rows={3} className={`${INPUT_CLASS} resize-none`} />
                  </div>
                </div>
              </div>

              <hr className="border-gray-100" />

              {/* Payment */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-5 w-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: BRAND }}>3</div>
                  <span className="text-sm font-semibold text-gray-700">Payment Structure</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-7">
                  <div>
                    <label className={LABEL_CLASS}>Payment Type</label>
                    <div className="relative">
                      <select value={form.paymentType} onChange={upd('paymentType')} className={`${INPUT_CLASS} appearance-none pr-8`}>
                        <option value="full">Full payment at signing</option>
                        <option value="deposit">Deposit + balance due before event</option>
                        <option value="installments">Custom installment plan</option>
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Deposit Amount ($)</label>
                    <input type="number" value={form.depositAmount} onChange={upd('depositAmount')} placeholder="1500" className={INPUT_CLASS} />
                  </div>
                </div>
              </div>

              <hr className="border-gray-100" />

              {/* Tone & notes */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-5 w-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: BRAND }}>4</div>
                  <span className="text-sm font-semibold text-gray-700">Style & Notes</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-7">
                  <div>
                    <label className={LABEL_CLASS}>Proposal Tone</label>
                    <div className="relative">
                      <select value={form.tone} onChange={upd('tone')} className={`${INPUT_CLASS} appearance-none pr-8`}>
                        <option value="professional">Professional & Formal</option>
                        <option value="warm">Warm & Personal</option>
                        <option value="luxury">Luxury & Elegant</option>
                        <option value="casual">Friendly & Casual</option>
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Special Notes / Requests</label>
                    <input type="text" value={form.specialNotes} onChange={upd('specialNotes')} placeholder="Outdoor ceremony, dietary restrictions, etc." className={INPUT_CLASS} />
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-7 py-4 border-t border-gray-100 bg-gray-50/60 flex items-center justify-between gap-3">
              <p className="text-xs text-gray-400">AI will generate a complete proposal you can edit before sending</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generating}
                  className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all whitespace-nowrap"
                  style={{ backgroundColor: BRAND }}
                >
                  <Sparkles size={15} />
                  Generate Proposal
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
