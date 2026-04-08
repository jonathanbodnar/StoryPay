'use client';

import { useEffect, useState } from 'react';
import { Mail, MessageSquare, Loader2, Save, CheckCircle2 } from 'lucide-react';

type Settings = Record<string, boolean>;

interface NotifItem {
  key: string;
  label: string;
  description: string;
}

const EMAIL_NOTIFICATIONS: NotifItem[] = [
  { key: 'email_payment_received',       label: 'Payment received',         description: 'When a payment is successfully processed' },
  { key: 'email_payment_failed',         label: 'Payment failed',            description: 'When a payment attempt fails' },
  { key: 'email_invoice_paid',           label: 'Invoice paid',              description: 'When an invoice is marked as paid' },
  { key: 'email_proposal_signed',        label: 'Proposal signed',           description: 'When a client signs a proposal' },
  { key: 'email_new_customer',           label: 'New customer',              description: 'When a new customer is added' },
  { key: 'email_subscription_created',   label: 'Subscription created',      description: 'When a new subscription starts' },
  { key: 'email_subscription_cancelled', label: 'Subscription cancelled',    description: 'When a subscription is cancelled' },
  { key: 'email_refund_issued',          label: 'Refund issued',             description: 'When a refund is processed' },
  { key: 'email_weekly_digest',          label: 'Weekly digest',             description: 'Summary of your weekly activity' },
];

const SMS_NOTIFICATIONS: NotifItem[] = [
  { key: 'sms_payment_received',         label: 'Payment received',          description: 'Get a text when a payment is received' },
  { key: 'sms_payment_failed',           label: 'Payment failed',             description: 'Get a text when a payment fails' },
  { key: 'sms_high_value_payment',       label: 'High-value payments',        description: 'Get a text for payments over $1,000' },
  { key: 'sms_proposal_signed',          label: 'Proposal signed',            description: 'Get a text when a client signs' },
  { key: 'sms_subscription_created',     label: 'Subscription created',       description: 'Get a text when a subscription starts' },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none ${
        checked ? 'bg-gray-900' : 'bg-gray-200'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`} />
    </button>
  );
}

function NotifRow({ item, value, onChange }: { item: NotifItem; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-gray-50 last:border-0">
      <div className="flex-1 pr-8">
        <p className="text-sm font-semibold text-gray-900">{item.label}</p>
        <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
      </div>
      <Toggle checked={value} onChange={onChange} />
    </div>
  );
}

export default function NotificationsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);

  useEffect(() => {
    fetch('/api/notifications').then(r => r.json()).then(d => {
      setSettings(d);
    }).finally(() => setLoading(false));
  }, []);

  function toggle(key: string, value: boolean) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-400" /></div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-heading text-2xl text-gray-900">Notifications</h1>
        <p className="mt-1 text-sm text-gray-500">Manage how you receive notifications about your account activity</p>
      </div>

      <div className="space-y-5 max-w-2xl">

        {/* Email Notifications */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center gap-2.5 px-6 py-4 border-b border-gray-100">
            <Mail size={16} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-900">Email Notifications</h2>
          </div>
          <div className="px-6">
            {EMAIL_NOTIFICATIONS.map(item => (
              <NotifRow
                key={item.key}
                item={item}
                value={settings[item.key] ?? false}
                onChange={v => toggle(item.key, v)}
              />
            ))}
          </div>
        </div>

        {/* SMS Notifications */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center gap-2.5 px-6 py-4 border-b border-gray-100">
            <MessageSquare size={16} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-900">SMS Notifications</h2>
          </div>
          <div className="px-6">
            {SMS_NOTIFICATIONS.map(item => (
              <NotifRow
                key={item.key}
                item={item}
                value={settings[item.key] ?? false}
                onChange={v => toggle(item.key, v)}
              />
            ))}
          </div>
        </div>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all shadow-sm"
            style={{ backgroundColor: '#293745' }}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
          </button>
          {saved && <p className="text-sm text-emerald-600 font-medium">Notification preferences saved.</p>}
        </div>
      </div>
    </div>
  );
}
