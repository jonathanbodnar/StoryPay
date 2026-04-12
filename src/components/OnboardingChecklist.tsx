'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2, Circle, X, Rocket, ArrowRight, Sparkles,
  CreditCard, Users, FileText, Palette, Mail, UsersRound,
} from 'lucide-react';

const STEPS = [
  'payment_processing',
  'first_customer',
  'first_proposal',
  'branding',
  'email_templates',
  'team_member',
] as const;

type StepId = typeof STEPS[number];

const STEP_META: Record<StepId, {
  label: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  cta: string;
}> = {
  payment_processing: { label: 'Configure Payment Processing', description: 'Connect LunarPay to accept credit cards & ACH payments.', href: '/dashboard/settings', icon: CreditCard, cta: 'Go to Settings' },
  first_customer:     { label: 'Add Your First Customer',       description: 'Create a customer profile to send proposals and invoices.', href: '/dashboard/customers', icon: Users, cta: 'Add Customer' },
  first_proposal:     { label: 'Create Your First Proposal',    description: 'Build and send a branded proposal or invoice to a client.', href: '/dashboard/payments/new', icon: FileText, cta: 'Create Proposal' },
  branding:           { label: 'Customize Your Branding',       description: 'Upload your logo and set your brand colors.', href: '/dashboard/settings/branding', icon: Palette, cta: 'Set Up Branding' },
  email_templates:    { label: 'Set Up Email Templates',        description: 'Customize the emails sent to your clients.', href: '/dashboard/settings/email-templates', icon: Mail, cta: 'Edit Templates' },
  team_member:        { label: 'Invite a Team Member',          description: 'Add your team so they can help manage your account.', href: '/dashboard/settings/team', icon: UsersRound, cta: 'Manage Team' },
};

function getStorageKey(venueId: string) {
  return `onboarding_steps_${venueId}`;
}
function getDismissedKey(venueId: string) {
  return `onboarding_dismissed_${venueId}`;
}

function loadCheckedSteps(venueId: string): Set<StepId> {
  try {
    const raw = localStorage.getItem(getStorageKey(venueId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr.filter((s): s is StepId => (STEPS as readonly string[]).includes(s)));
  } catch { return new Set(); }
}

function saveCheckedSteps(venueId: string, steps: Set<StepId>) {
  try {
    localStorage.setItem(getStorageKey(venueId), JSON.stringify([...steps]));
  } catch { /* storage unavailable */ }
}

function loadDismissed(venueId: string): boolean {
  try {
    return localStorage.getItem(getDismissedKey(venueId)) === 'true';
  } catch { return false; }
}

function saveDismissed(venueId: string, val: boolean) {
  try {
    if (val) localStorage.setItem(getDismissedKey(venueId), 'true');
    else localStorage.removeItem(getDismissedKey(venueId));
  } catch { /* storage unavailable */ }
}

export default function OnboardingChecklist() {
  const router = useRouter();
  const [venueId, setVenueId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<StepId>>(new Set());
  const [dismissed, setDismissed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Load venue ID then hydrate from localStorage
  const init = useCallback(async () => {
    try {
      const res = await fetch('/api/venues/me', { cache: 'no-store' });
      if (!res.ok) return;
      const venue = await res.json();
      const id: string = venue.id;
      setVenueId(id);
      setChecked(loadCheckedSteps(id));
      setDismissed(
        loadDismissed(id) ||
        venue.onboarding_checklist_dismissed === true ||
        venue.onboarding_checklist_completed === true
      );
    } catch { /* non-critical */ }
    finally { setMounted(true); }
  }, []);

  useEffect(() => { init(); }, [init]);

  function toggleStep(stepId: StepId) {
    if (!venueId) return;
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      saveCheckedSteps(venueId, next);
      return next;
    });
  }

  async function confirmComplete() {
    if (!venueId) return;
    setConfirming(true);
    saveDismissed(venueId, true);
    setDismissed(true);
    setModalOpen(false);
    // Persist to DB (best-effort — localStorage is the source of truth)
    fetch('/api/onboarding', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss' }),
    }).catch(() => {});
    setConfirming(false);
  }

  // Called by Settings "Restart Guide" — clears localStorage and DB flag
  // This is triggered by a custom event dispatched from the settings page
  useEffect(() => {
    function onReset() {
      if (!venueId) return;
      saveDismissed(venueId, false);
      saveCheckedSteps(venueId, new Set());
      setChecked(new Set());
      setDismissed(false);
    }
    window.addEventListener('onboarding:reset', onReset);
    return () => window.removeEventListener('onboarding:reset', onReset);
  }, [venueId]);

  if (!mounted || dismissed) return null;

  const completedCount = checked.size;
  const totalSteps = STEPS.length;
  const pct = Math.round((completedCount / totalSteps) * 100);
  const allChecked = completedCount === totalSteps;

  return (
    <>
      {/* Dashboard bubble */}
      <div className="mb-6 flex items-center gap-2">
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2.5 rounded-full border border-gray-200 bg-white px-4 py-2 shadow-sm hover:shadow-md hover:border-gray-300 transition-all"
        >
          <Rocket size={14} className="text-[#1b1b1b] flex-shrink-0" />
          <span className="text-sm font-semibold text-gray-800">Get Started</span>
          <div className="flex items-center gap-1.5 ml-0.5">
            <span className="text-xs text-gray-400">{completedCount}/{totalSteps}</span>
            <div className="h-2 w-16 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full bg-[#1b1b1b] transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </button>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 bg-[#1b1b1b]">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
                  <Rocket size={17} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white leading-tight">Get Started with StoryPay</p>
                  <p className="text-xs text-white/60 mt-0.5">{completedCount} of {totalSteps} steps completed</p>
                </div>
              </div>
              <button onClick={() => setModalOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white">
                <X size={14} />
              </button>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-gray-100">
              <div className="h-full bg-[#1b1b1b] transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>

            {/* Steps */}
            <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
              {STEPS.map((stepId) => {
                const meta = STEP_META[stepId];
                const isChecked = checked.has(stepId);
                const Icon = meta.icon;

                return (
                  <div key={stepId}
                    className={`flex items-center gap-4 px-6 py-4 transition-colors ${isChecked ? 'bg-gray-50/60' : 'hover:bg-gray-50/40'}`}>

                    <button
                      onClick={() => toggleStep(stepId)}
                      className="flex-shrink-0 transition-transform hover:scale-110"
                      title={isChecked ? 'Uncheck' : 'Mark as done'}
                    >
                      {isChecked
                        ? <CheckCircle2 size={22} className="text-emerald-500" />
                        : <Circle size={22} className="text-gray-300 hover:text-gray-400" />
                      }
                    </button>

                    <div className={`flex-shrink-0 flex h-9 w-9 items-center justify-center rounded-xl ${isChecked ? 'bg-emerald-50' : 'bg-gray-100'}`}>
                      <Icon size={16} className={isChecked ? 'text-emerald-500' : 'text-gray-500'} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium leading-tight ${isChecked ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                        {meta.label}
                      </p>
                      {!isChecked && <p className="mt-0.5 text-xs text-gray-500">{meta.description}</p>}
                    </div>

                    {!isChecked && (
                      <button
                        onClick={() => { setModalOpen(false); router.push(meta.href); }}
                        className="flex-shrink-0 flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-all"
                      >
                        {meta.cta} <ArrowRight size={10} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100">
              {allChecked ? (
                <button
                  onClick={confirmComplete}
                  disabled={confirming}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 px-5 py-3 text-sm font-bold text-white transition-colors disabled:opacity-60"
                >
                  <Sparkles size={15} />
                  {confirming ? 'Saving...' : "I'm Ready — Start Using StoryPay"}
                </button>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">Check off each step when done</p>
                  <button onClick={() => setModalOpen(false)}
                    className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
