'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2, Circle, X, ChevronDown, ChevronUp,
  CreditCard, Users, FileText, Palette, Mail, UsersRound,
  Rocket, ArrowRight,
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
  const [collapsed, setCollapsed] = useState(false);
  const [visible, setVisible] = useState(true);
  const [togglingStep, setTogglingStep] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/onboarding', { cache: 'no-store' });
      if (!res.ok) return;
      const json: OnboardingData = await res.json();
      if (json.dismissed || json.completed) setVisible(false);
      setData(json);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function dismiss() {
    await fetch('/api/onboarding', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss' }),
    });
    setVisible(false);
  }

  async function toggleStep(step: Step) {
    if (togglingStep) return;
    setTogglingStep(step.id);
    try {
      if (step.completed) {
        // Only allow unchecking manually-completed steps (auto-detected ones
        // like branding/payment can't be unchecked since they reflect real data)
        await fetch('/api/onboarding', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'uncheck_step', step: step.id }),
        });
      } else {
        await fetch('/api/onboarding', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step: step.id }),
        });
      }
      await load();
    } finally { setTogglingStep(null); }
  }

  if (!visible || !data) return null;

  const { steps, completedCount, totalSteps } = data;
  const pct = Math.round((completedCount / totalSteps) * 100);
  const allDone = completedCount === totalSteps;

  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-5 py-4 bg-[#1b1b1b]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
            <Rocket size={18} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white leading-tight">
              {allDone ? 'Setup Complete!' : 'Get Started with StoryPay'}
            </p>
            <p className="text-xs text-white/60 mt-0.5">
              {allDone
                ? 'Your account is fully configured.'
                : `${completedCount} of ${totalSteps} steps completed`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Progress pill */}
          <div className="hidden sm:flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5">
            <span className="text-xs font-semibold text-white">{pct}%</span>
            <div className="h-1.5 w-20 rounded-full bg-white/20 overflow-hidden">
              <div className="h-full rounded-full bg-white transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <button onClick={() => setCollapsed(c => !c)}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white">
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button onClick={dismiss}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white"
            title="Dismiss — can be restarted in Settings → General">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Mobile progress bar */}
      <div className="sm:hidden h-1 bg-gray-100">
        <div className="h-full bg-[#1b1b1b] transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>

      {/* Steps */}
      {!collapsed && (
        <div className="divide-y divide-gray-100">
          {steps.map((step) => {
            const meta = STEP_META[step.id];
            if (!meta) return null;
            const Icon = meta.icon;
            const busy = togglingStep === step.id;

            return (
              <div key={step.id}
                className={`flex items-center gap-4 px-5 py-4 transition-colors ${step.completed ? 'bg-gray-50/60' : 'bg-white hover:bg-gray-50/40'}`}>

                {/* Checkbox toggle */}
                <button
                  onClick={() => toggleStep(step)}
                  disabled={busy}
                  className="flex-shrink-0 transition-transform hover:scale-110 disabled:opacity-50"
                  title={step.completed ? 'Mark as incomplete' : 'Mark as complete'}
                >
                  {step.completed
                    ? <CheckCircle2 size={22} className="text-emerald-500" />
                    : <Circle size={22} className="text-gray-300 hover:text-gray-400" />}
                </button>

                {/* Icon */}
                <div className={`flex-shrink-0 flex h-9 w-9 items-center justify-center rounded-xl ${step.completed ? 'bg-emerald-50' : 'bg-gray-100'}`}>
                  <Icon size={16} className={step.completed ? 'text-emerald-500' : 'text-gray-500'} />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium leading-tight ${step.completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                    {meta.label}
                  </p>
                  {!step.completed && (
                    <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{meta.description}</p>
                  )}
                </div>

                {/* Action */}
                {step.completed ? (
                  <span className="flex-shrink-0 text-xs font-medium text-emerald-600 bg-emerald-50 rounded-full px-2.5 py-1">Done</span>
                ) : (
                  <button
                    onClick={() => router.push(meta.href)}
                    className="flex-shrink-0 flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-all"
                  >
                    {meta.cta} <ArrowRight size={11} />
                  </button>
                )}
              </div>
            );
          })}

          {/* All done */}
          {allDone && (
            <div className="flex items-center justify-between gap-4 px-5 py-4 bg-emerald-50">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={20} className="text-emerald-500 flex-shrink-0" />
                <p className="text-sm font-medium text-emerald-800">
                  Your account is fully set up. You&apos;re ready to go!
                </p>
              </div>
              <button onClick={dismiss}
                className="flex-shrink-0 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-600 transition-colors">
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
