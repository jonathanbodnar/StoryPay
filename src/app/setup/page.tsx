'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface OnboardingStatus {
  status: string;
  mpaEmbedUrl?: string;
}

interface VenueInfo {
  id: string;
  name: string;
  onboarding_status: string | null;
  ghl_connected: boolean;
}

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [venue, setVenue] = useState<VenueInfo | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVenue = useCallback(async () => {
    const res = await fetch('/api/venues/me');
    if (!res.ok) {
      router.push('/');
      return null;
    }
    const data = await res.json();
    setVenue(data);
    return data as VenueInfo;
  }, [router]);

  const checkOnboarding = useCallback(async () => {
    setPolling(true);
    try {
      const res = await fetch('/api/venues/onboarding-status');
      if (res.ok) {
        const data = await res.json();
        setOnboarding(data);
        setVenue((prev) => prev ? { ...prev, onboarding_status: data.status } : prev);
      }
    } finally {
      setPolling(false);
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      const venueData = await fetchVenue();
      if (!venueData) return;

      if (venueData.onboarding_status === 'active' && venueData.ghl_connected) {
        setStep(3);
      } else if (venueData.onboarding_status === 'active') {
        setStep(2);
      } else {
        setStep(1);
      }

      await checkOnboarding();
      setLoading(false);
    }
    init();
  }, [fetchVenue, checkOnboarding]);

  const paymentReady = onboarding?.status === 'active' || venue?.onboarding_status === 'active';
  const ghlReady = venue?.ghl_connected ?? false;

  async function handleCompleteSetup() {
    setCompleting(true);
    setError(null);
    try {
      const res = await fetch('/api/venues/complete-setup', { method: 'POST' });
      if (res.ok) {
        router.push('/dashboard');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to complete setup');
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setCompleting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-navy-800/10" />
          <div className="h-4 w-32 rounded bg-navy-800/10" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="font-heading text-3xl text-navy-900 mb-2">Set Up {venue?.name || 'Your Venue'}</h1>
          <p className="text-gray-500">Complete these steps to start accepting payments</p>
        </div>

        <StepIndicator currentStep={step} paymentReady={paymentReady} ghlReady={ghlReady} />

        <div className="mt-10">
          {step === 1 && (
            <StepCard
              number={1}
              title="Connect Your Payment Processor"
              active
            >
              <p className="text-gray-600 mb-6">
                Connect your LunarPay account to process payments through StoryPay.
              </p>

              {onboarding?.status === 'active' ? (
                <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                  <CheckCircle />
                  <span className="text-green-800 font-medium">Payment processor connected</span>
                </div>
              ) : (
                <div className="space-y-4">
                  {onboarding?.mpaEmbedUrl && (
                    <a
                      href={onboarding.mpaEmbedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full text-center bg-navy-800 hover:bg-navy-900 text-white font-medium py-3 px-6 rounded-xl transition-colors"
                    >
                      Complete Onboarding
                    </a>
                  )}
                  <button
                    onClick={checkOnboarding}
                    disabled={polling}
                    className="w-full border-2 border-navy-800 text-navy-800 hover:bg-navy-800/5 font-medium py-3 px-6 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {polling ? 'Checking…' : 'Check Status'}
                  </button>
                  {onboarding && onboarding.status !== 'active' && (
                    <p className="text-sm text-amber-600 text-center">
                      Status: <span className="font-medium capitalize">{onboarding.status}</span>
                      {' — '}Complete the onboarding form above, then check again.
                    </p>
                  )}
                </div>
              )}

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setStep(2)}
                  disabled={!paymentReady}
                  className="bg-navy-800 hover:bg-navy-900 text-white font-medium py-2.5 px-8 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              </div>
            </StepCard>
          )}

          {step === 2 && (
            <StepCard
              number={2}
              title="Connect Messaging"
              active
            >
              <p className="text-gray-600 mb-6">
                Link your messaging account to enable automated SMS and contact management.
              </p>

              {ghlReady ? (
                <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                  <CheckCircle />
                  <span className="text-green-800 font-medium">Messaging connected</span>
                </div>
              ) : (
                <a
                  href="/api/ghl/oauth"
                  className="block w-full text-center bg-navy-800 hover:bg-navy-900 text-white font-medium py-3 px-6 rounded-xl transition-colors"
                >
                  Connect Messaging
                </a>
              )}

              <div className="mt-6 flex justify-between">
                <button
                  onClick={() => setStep(1)}
                  className="text-navy-800 hover:text-navy-900 font-medium py-2.5 px-6 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!ghlReady}
                  className="bg-navy-800 hover:bg-navy-900 text-white font-medium py-2.5 px-8 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              </div>
            </StepCard>
          )}

          {step === 3 && (
            <StepCard
              number={3}
              title="Complete Setup"
              active
            >
              <p className="text-gray-600 mb-6">
                Review your connections and finalize your venue setup.
              </p>

              <div className="space-y-3 mb-8">
                <SummaryRow label="Payment Processor" ready={paymentReady} />
                <SummaryRow label="Messaging" ready={ghlReady} />
              </div>

              {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                  {error}
                </div>
              )}

              <button
                onClick={handleCompleteSetup}
                disabled={!paymentReady || !ghlReady || completing}
                className="w-full bg-teal-500 hover:bg-teal-600 text-white font-semibold py-3.5 px-6 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-lg"
              >
                {completing ? 'Completing Setup…' : 'Complete Setup'}
              </button>

              <div className="mt-4 flex justify-start">
                <button
                  onClick={() => setStep(2)}
                  className="text-navy-800 hover:text-navy-900 font-medium py-2.5 px-6 transition-colors"
                >
                  Back
                </button>
              </div>
            </StepCard>
          )}
        </div>
      </div>
    </div>
  );
}

function StepIndicator({
  currentStep,
  paymentReady,
  ghlReady,
}: {
  currentStep: number;
  paymentReady: boolean;
  ghlReady: boolean;
}) {
  const steps = [
    { number: 1, label: 'Payments', done: paymentReady },
    { number: 2, label: 'GHL', done: ghlReady },
    { number: 3, label: 'Finish', done: false },
  ];

  return (
    <div className="flex items-center justify-center gap-0">
      {steps.map((s, i) => (
        <div key={s.number} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                s.done
                  ? 'bg-teal-500 text-white'
                  : currentStep === s.number
                    ? 'bg-navy-800 text-white'
                    : 'bg-gray-200 text-gray-500'
              }`}
            >
              {s.done ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                s.number
              )}
            </div>
            <span className="text-xs mt-1.5 text-gray-500 font-medium">{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={`w-20 h-0.5 mx-2 mb-5 transition-colors ${
                s.done ? 'bg-teal-500' : 'bg-gray-200'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function StepCard({
  number,
  title,
  active,
  children,
}: {
  number: number;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`bg-white rounded-2xl shadow-sm border p-8 transition-all ${
        active ? 'border-navy-800/20 shadow-lg' : 'border-gray-100'
      }`}
    >
      <div className="flex items-center gap-3 mb-6">
        <span className="text-sm font-semibold text-navy-800 bg-navy-800/5 rounded-full w-8 h-8 flex items-center justify-center">
          {number}
        </span>
        <h2 className="font-heading text-xl text-navy-900">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function SummaryRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
      <span className="text-gray-700 font-medium">{label}</span>
      {ready ? (
        <span className="flex items-center gap-2 text-green-600 font-medium text-sm">
          <CheckCircle />
          Connected
        </span>
      ) : (
        <span className="flex items-center gap-2 text-amber-600 font-medium text-sm">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Not connected
        </span>
      )}
    </div>
  );
}

function CheckCircle() {
  return (
    <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
