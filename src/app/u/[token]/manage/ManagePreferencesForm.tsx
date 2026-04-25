'use client';

import { useState } from 'react';

export function ManagePreferencesForm({
  token,
  email,
  venueName,
  initiallySubscribed,
}: {
  token: string;
  email: string;
  venueName: string;
  initiallySubscribed: boolean;
}) {
  const [subscribed, setSubscribed] = useState<boolean>(initiallySubscribed);
  const [saving, setSaving] = useState(false);
  const [savedFor, setSavedFor] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(next: boolean) {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/public/marketing/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, subscribed: next }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || 'Could not save your preference. Please try again.');
      }
      setSubscribed(next);
      setSavedFor(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* Email box */}
      <div className="mb-5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 mb-0.5">Sending to</p>
        <p className="text-sm font-medium text-gray-900 break-all">{email || 'your email'}</p>
      </div>

      {/* Choice tiles */}
      <div className="space-y-3">
        <Tile
          active={subscribed}
          title="Subscribed"
          description={`I want to keep receiving marketing emails from ${venueName}.`}
          onClick={() => void save(true)}
          disabled={saving}
        />
        <Tile
          active={!subscribed}
          title="Unsubscribed"
          description={`Stop sending me marketing emails from ${venueName}. (Transactional and booking-related emails may still come through.)`}
          onClick={() => void save(false)}
          disabled={saving}
          tone="danger"
        />
      </div>

      {/* Status */}
      {savedFor !== null && !saving && !error && (
        <div className={`mt-5 rounded-lg px-4 py-3 text-sm font-medium ${savedFor ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}>
          {savedFor
            ? `You're subscribed. We've updated your preferences.`
            : `You're unsubscribed. You won't receive marketing emails from ${venueName}.`}
        </div>
      )}
      {error && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}

function Tile({
  active,
  title,
  description,
  onClick,
  disabled,
  tone = 'primary',
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'danger';
}) {
  const ringColor = tone === 'danger' ? 'border-red-500 ring-red-100' : 'border-gray-900 ring-gray-100';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left rounded-xl border-2 px-4 py-3.5 transition-all ${
        active
          ? `${ringColor} ring-4 bg-white`
          : 'border-gray-200 bg-white hover:border-gray-400'
      } ${disabled ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-1 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${
            active
              ? tone === 'danger'
                ? 'border-red-500 bg-red-500'
                : 'border-gray-900 bg-gray-900'
              : 'border-gray-300 bg-white'
          }`}
        >
          {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
        </span>
        <span>
          <span className="block text-sm font-semibold text-gray-900">{title}</span>
          <span className="mt-0.5 block text-xs text-gray-500 leading-relaxed">{description}</span>
        </span>
      </div>
    </button>
  );
}
