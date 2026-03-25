'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Send, LinkIcon, Loader2 } from 'lucide-react';

interface Venue {
  id: string;
  ghl_connected: boolean;
}

interface Customer {
  id: number;
  name: string;
  phone?: string;
  email?: string;
}

export default function SmsPage() {
  const [venue, setVenue] = useState<Venue | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const venueRes = await fetch('/api/venues/me');
        if (venueRes.ok) {
          const v = await venueRes.json();
          setVenue(v);

          if (v.ghl_connected) {
            const custRes = await fetch('/api/customers?limit=100');
            if (custRes.ok) {
              const data = await custRes.json();
              const list = Array.isArray(data) ? data : data.data ?? [];
              setCustomers(list.filter((c: Customer) => c.phone));
            }
          }
        }
      } catch {
        // handled by null venue state
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCustomer || !message.trim()) return;

    const customer = customers.find((c) => String(c.id) === selectedCustomer);
    if (!customer?.phone) return;

    setSending(true);
    setSendResult(null);

    try {
      const res = await fetch('/api/messaging/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: customer.phone, message: message.trim() }),
      });

      if (res.ok) {
        setSendResult({ success: true, text: 'Message sent successfully!' });
        setMessage('');
        setSelectedCustomer('');
      } else {
        const err = await res.json();
        setSendResult({ success: false, text: err.error || 'Failed to send message' });
      }
    } catch {
      setSendResult({ success: false, text: 'Network error — please try again' });
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-semibold text-gray-900">SMS</h1>
        <p className="mt-1 text-sm text-gray-500">Send messages to your customers</p>
      </div>

      {!venue?.ghl_connected ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-900/10">
            <LinkIcon size={24} className="text-brand-900" />
          </div>
          <h2 className="font-heading text-lg font-semibold text-gray-900">Connect Messaging</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
            Connect your messaging account to send SMS messages to your customers directly from
            StoryPay.
          </p>
          <a
            href="/dashboard/settings"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            <LinkIcon size={16} />
            Go to Settings
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Send SMS Form */}
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="font-heading text-lg font-semibold text-gray-900 mb-4">
              Send a Message
            </h2>

            <form onSubmit={handleSend} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  Recipient
                </label>
                <select
                  value={selectedCustomer}
                  onChange={(e) => setSelectedCustomer(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none"
                >
                  <option value="">Select a customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.phone}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  Message
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  placeholder="Type your message…"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none resize-none"
                />
              </div>

              {sendResult && (
                <div
                  className={`rounded-lg px-4 py-3 text-sm ${
                    sendResult.success
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-red-50 text-red-700'
                  }`}
                >
                  {sendResult.text}
                </div>
              )}

              <button
                type="submit"
                disabled={sending || !selectedCustomer || !message.trim()}
                className="flex items-center gap-2 rounded-lg bg-brand-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
                {sending ? 'Sending…' : 'Send SMS'}
              </button>
            </form>
          </div>

          {/* SMS Info */}
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="font-heading text-lg font-semibold text-gray-900 mb-4">
              Automatic SMS
            </h2>

            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg bg-gray-50 p-4">
                <MessageSquare size={20} className="mt-0.5 shrink-0 text-brand-900" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Proposal Notifications</p>
                  <p className="mt-1 text-sm text-gray-500">
                    When you create a proposal for a customer with a phone number, an SMS with the
                    proposal link is automatically sent via your connected messaging account.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg bg-gray-50 p-4">
                <MessageSquare size={20} className="mt-0.5 shrink-0 text-brand-900" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Payment Reminders</p>
                  <p className="mt-1 text-sm text-gray-500">
                    Upcoming payment reminders are sent automatically based on your payment schedule
                    configurations.
                  </p>
                </div>
              </div>

              <p className="text-xs text-gray-400">
                All SMS messages are sent through your connected messaging account.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
