'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Circle,
  X,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Users,
  FileText,
  Palette,
  Mail,
  UsersRound,
  Rocket,
  ArrowRight,
} from 'lucide-react';

interface Step {
  id: string;
  completed: boolean;
}

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
    description: 'Customize the emails sent to your clients for proposals and invoices.',
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
  const [data, setData] = useState<OnboardingData | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [visible, setVisible] = useState(true);
  const [dismissing, setDismissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/onboarding');
      if (!res.ok) return;
      const json: OnboardingData = await res.json();
      if (json.dismissed || json.completed) {
        setVisible(false);
      }
      setData(json);
    } catch {
      // silently fail — onboarding is non-critical
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function dismiss() {
    setDismissing(true);
    try {
      await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss' }),
      });
    } finally {
      setVisible(false);
    }
  }

  if (!visible || !data) return null;

  const { steps, completedCount, totalSteps } = data;
  const pct = Math.round((completedCount / totalSteps) * 100);
  const allDone = completedCount === totalSteps;
  const nextStep = steps.find(s => !s.completed);

  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* ── Header ── */}
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
              {allDone ? 'Your account is fully configured.' : `${completedCount} of ${totalSteps} steps completed`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Progress pill */}
          <div className="hidden sm:flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5">
            <span className="text-xs font-semibold text-white">{pct}%</span>
            <div className="h-1.5 w-20 rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full rounded-full bg-white transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {/* Dismiss */}
          <button
            onClick={dismiss}
            disabled={dismissing}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white"
            aria-label="Dismiss setup guide"
            title="Dismiss — I'll set up on my own"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Progress bar (mobile) ── */}
      <div className="sm:hidden h-1 bg-gray-100">
        <div
          className="h-full bg-[#1b1b1b] transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* ── Steps list ── */}
      {!collapsed && (
        <div className="divide-y divide-gray-100">
          {steps.map((step, idx) => {
            const meta = STEP_META[step.id];
            if (!meta) return null;
            const Icon = meta.icon;
            const isNext = nextStep?.id === step.id;

            return (
              <div
                key={step.id}
                className={`flex items-start gap-4 px-5 py-4 transition-colors ${
                  step.completed
                    ? 'bg-gray-50/50'
                    : isNext
                    ? 'bg-blue-50/30'
                    : 'bg-white'
                }`}
              >
                {/* Step number / check icon */}
                <div className="flex-shrink-0 pt-0.5">
                  {step.completed ? (
                    <CheckCircle2 size={20} className="text-emerald-500" />
                  ) : isNext ? (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#1b1b1b] bg-white">
                      <span className="text-[10px] font-bold text-[#1b1b1b]">{idx + 1}</span>
                    </div>
                  ) : (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-gray-200">
                      <span className="text-[10px] font-medium text-gray-400">{idx + 1}</span>
                    </div>
                  )}
                </div>

                {/* Icon */}
                <div className={`flex-shrink-0 flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                  step.completed ? 'bg-emerald-50' : isNext ? 'bg-[#1b1b1b]' : 'bg-gray-100'
                }`}>
                  <Icon
                    size={16}
                    className={step.completed ? 'text-emerald-500' : isNext ? 'text-white' : 'text-gray-400'}
                  />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium leading-tight ${
                    step.completed ? 'text-gray-400 line-through' : 'text-gray-900'
                  }`}>
                    {meta.label}
                  </p>
                  {!step.completed && (
                    <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{meta.description}</p>
                  )}
                </div>

                {/* CTA */}
                {!step.completed && (
                  <Link
                    href={meta.href}
                    className={`flex-shrink-0 flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                      isNext
                        ? 'bg-[#1b1b1b] text-white hover:bg-[#2d2d2d]'
                        : 'bg-white border border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {meta.cta}
                    <ArrowRight size={11} />
                  </Link>
                )}
                {step.completed && (
                  <span className="flex-shrink-0 text-xs font-medium text-emerald-500 bg-emerald-50 rounded-full px-2.5 py-1">
                    Done
                  </span>
                )}
              </div>
            );
          })}

          {/* All done footer */}
          {allDone && (
            <div className="flex items-center justify-between gap-4 px-5 py-4 bg-emerald-50">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={20} className="text-emerald-500 flex-shrink-0" />
                <p className="text-sm font-medium text-emerald-800">
                  Your account is fully set up. You&apos;re ready to go!
                </p>
              </div>
              <button
                onClick={dismiss}
                className="flex-shrink-0 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-600 transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
