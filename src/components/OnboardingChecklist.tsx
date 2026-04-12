'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2, Circle, X, Rocket, ArrowRight,
  CreditCard, Users, FileText, Palette, Mail, UsersRound,
} from 'lucide-react';

interface Step { id: string; completed: boolean; }
interface OnboardingData {
  steps: Step[];
  completedCount: number;
  totalSteps: number;
  dismissed: boolean;
  completed: boolean;
  venueName: string;
}

const STEP_META: Record<string, {
  label: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  cta: string;
}> = {
  payment_processing: {
    label: 'Configure Payment Processing',
    description: 'Connect your LunarPay account to accept credit cards & ACH payments.',
    href: '/dashboard/settings',
    icon: CreditCard,
    cta: 'Go to Settings',
  },
  first_customer: {
    label: 'Add Your First Customer',
    description: 'Create a customer profile so you can send proposals and invoices.',
    href: '/dashboard/customers',
    icon: Users,
    cta: 'Add Customer',
  },
  first_proposal: {
    label: 'Create Your First Proposal',
    description: 'Build and send a branded proposal or invoice to a client.',
    href: '/dashboard/payments/new',
    icon: FileText,
    cta: 'Create Proposal',
  },
  branding: {
    label: 'Customize Your Branding',
    description: 'Upload your logo and set your brand colors for all documents.',
    href: '/dashboard/settings/branding',
    icon: Palette,
    cta: 'Set Up Branding',
  },
  email_templates: {
    label: 'Set Up Email Templates',
    description: 'Customize the emails sent to your clients.',
    href: '/dashboard/settings/email-templates',
    icon: Mail,
    cta: 'Edit Templates',
  },
  team_member: {
    label: 'Invite a Team Member',
    description: 'Add your team so they can help manage your account.',
    href: '/dashboard/settings/team',
    icon: UsersRound,
    cta: 'Manage Team',
  },
};

export default function OnboardingChecklist() {
  const router = useRouter();
  const [data, setData] = useState<OnboardingData | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [togglingStep, setTogglingStep] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/onboarding', { cache: 'no-store' });
      if (!res.ok) return;
      setData(await res.json());
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function dismiss() {
    // Optimistically hide immediately — don't wait for a round-trip
    setData(d => d ? { ...d, dismissed: true } : d);
    setModalOpen(false);
    // Persist in background
    fetch('/api/onboarding', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss' }),
    }).catch(() => {});
  }

  async function toggleStep(step: Step) {
    if (togglingStep) return;
    setTogglingStep(step.id);
    // Optimistically flip the step immediately
    setData(d => {
      if (!d) return d;
      const steps = d.steps.map(s =>
        s.id === step.id ? { ...s, completed: !s.completed } : s
      );
      const completedCount = steps.filter(s => s.completed).length;
      return { ...d, steps, completedCount, completed: completedCount === d.totalSteps };
    });
    try {
      await fetch('/api/onboarding', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          step.completed
            ? { action: 'uncheck_step', step: step.id }
            : { step: step.id }
        ),
      });
      // Sync from server to confirm
      await load();
    } catch {
      // On error revert by re-loading
      await load();
    } finally { setTogglingStep(null); }
  }

  // Hidden when dismissed or all steps manually checked
  if (!data || data.dismissed || data.completed) return null;

  const { steps, completedCount, totalSteps } = data;
  const pct = Math.round((completedCount / totalSteps) * 100);
  const allDone = completedCount === totalSteps;

  return (
    <>
      {/* ── Dashboard bubble ── */}
      <div className="mb-6 flex items-center gap-2">
        {/* Pill button to open modal */}
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2.5 rounded-full border border-gray-200 bg-white px-4 py-2 shadow-sm hover:shadow-md hover:border-gray-300 transition-all group"
        >
          <Rocket size={15} className="text-[#1b1b1b] flex-shrink-0" />
          <span className="text-sm font-semibold text-gray-800">Get Started</span>
          {/* Progress indicator */}
          <div className="flex items-center gap-1.5 ml-0.5">
            <span className="text-xs text-gray-400">{completedCount}/{totalSteps}</span>
            <div className="h-2 w-16 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#1b1b1b] transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </button>

        {/* X to dismiss bubble entirely */}
        <button
          onClick={dismiss}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 hover:text-gray-600 hover:border-gray-300 shadow-sm transition-all"
          title="Dismiss setup guide"
        >
          <X size={13} />
        </button>
      </div>

      {/* ── Modal ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-5 bg-[#1b1b1b]">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
                  <Rocket size={17} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white leading-tight">
                    {allDone ? 'Setup Complete!' : 'Get Started with StoryPay'}
                  </p>
                  <p className="text-xs text-white/60 mt-0.5">
                    {completedCount} of {totalSteps} steps completed
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-gray-100">
              <div
                className="h-full bg-[#1b1b1b] transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>

            {/* Steps list */}
            <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
              {steps.map((step) => {
                const meta = STEP_META[step.id];
                if (!meta) return null;
                const Icon = meta.icon;
                const busy = togglingStep === step.id;

                return (
                  <div
                    key={step.id}
                    className={`flex items-center gap-4 px-6 py-4 transition-colors ${step.completed ? 'bg-gray-50/60' : 'hover:bg-gray-50/40'}`}
                  >
                    {/* Check toggle */}
                    <button
                      onClick={() => toggleStep(step)}
                      disabled={busy}
                      className="flex-shrink-0 transition-transform hover:scale-110 disabled:opacity-40"
                      title={step.completed ? 'Mark as incomplete' : 'Mark as complete'}
                    >
                      {busy
                        ? <Circle size={22} className="text-gray-200 animate-pulse" />
                        : step.completed
                          ? <CheckCircle2 size={22} className="text-emerald-500" />
                          : <Circle size={22} className="text-gray-300 hover:text-gray-400" />
                      }
                    </button>

                    {/* Icon */}
                    <div className={`flex-shrink-0 flex h-9 w-9 items-center justify-center rounded-xl ${step.completed ? 'bg-emerald-50' : 'bg-gray-100'}`}>
                      <Icon size={16} className={step.completed ? 'text-emerald-500' : 'text-gray-500'} />
                    </div>

                    {/* Label */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium leading-tight ${step.completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                        {meta.label}
                      </p>
                      {!step.completed && (
                        <p className="mt-0.5 text-xs text-gray-500">{meta.description}</p>
                      )}
                    </div>

                    {/* CTA */}
                    {!step.completed && (
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

            {/* All done footer */}
            {allDone && (
              <div className="px-6 py-4 bg-emerald-50 border-t border-emerald-100 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />
                  <p className="text-sm font-medium text-emerald-800">All steps complete — you&apos;re ready!</p>
                </div>
                <button
                  onClick={dismiss}
                  className="flex-shrink-0 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-600 transition-colors"
                >
                  Done
                </button>
              </div>
            )}

            {/* Modal footer */}
            {!allDone && (
              <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
                <button
                  onClick={dismiss}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Dismiss setup guide
                </button>
                <button
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl bg-[#1b1b1b] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d2d2d] transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
