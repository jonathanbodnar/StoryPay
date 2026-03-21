'use client';

import { useState } from 'react';
import { Send, Loader2, Mail, CheckCircle } from 'lucide-react';

const categories = ['Billing', 'Technical', 'General', 'Other'];

export default function SupportPage() {
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('General');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject || !message || !email) return;

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, category, message, email }),
      });

      if (res.ok) {
        setSubmitted(true);
        setSubject('');
        setMessage('');
        setEmail('');
        setCategory('General');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to submit ticket');
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-semibold text-gray-900">Support</h1>
        <p className="mt-1 text-sm text-gray-500">Get help from our team</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Support Form */}
        <div className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-6">
          {submitted ? (
            <div className="py-10 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle size={28} className="text-emerald-600" />
              </div>
              <h2 className="font-heading text-lg font-semibold text-gray-900">
                Ticket Submitted
              </h2>
              <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500">
                We&apos;ve received your support request and will get back to you as soon as
                possible.
              </p>
              <button
                onClick={() => setSubmitted(false)}
                className="mt-6 rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Submit Another Ticket
              </button>
            </div>
          ) : (
            <>
              <h2 className="font-heading text-lg font-semibold text-gray-900 mb-5">
                Submit a Ticket
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                    Subject *
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    required
                    placeholder="Brief description of your issue"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                    Message *
                  </label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    required
                    rows={5}
                    placeholder="Describe your issue in detail…"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="your@email.com"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                  />
                </div>

                {error && (
                  <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !subject || !message || !email}
                  className="flex items-center gap-2 rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Send size={16} />
                  )}
                  {submitting ? 'Submitting…' : 'Submit Ticket'}
                </button>
              </form>
            </>
          )}
        </div>

        {/* Contact Info Sidebar */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 h-fit">
          <h2 className="font-heading text-lg font-semibold text-gray-900 mb-4">Contact Us</h2>

          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg bg-gray-50 p-4">
              <Mail size={20} className="mt-0.5 shrink-0 text-teal-600" />
              <div>
                <p className="text-sm font-medium text-gray-900">Email Support</p>
                <a
                  href="mailto:support@storyvenuemarketing.com"
                  className="mt-1 text-sm text-teal-600 hover:underline"
                >
                  support@storyvenuemarketing.com
                </a>
              </div>
            </div>

            <p className="text-xs text-gray-400">
              Need immediate help? Email us directly and we&apos;ll respond within 24 hours.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
