'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, FileText } from 'lucide-react';
import { formatCents } from '@/lib/utils';

interface Template {
  id: string;
  name: string;
  price: number;
  payment_type: string;
  payment_config: Record<string, unknown>;
}

export default function NewProposalPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [templateId, setTemplateId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  const selectedTemplate = templates.find((t) => t.id === templateId);

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const res = await fetch('/api/templates');
        if (res.ok) {
          const data = await res.json();
          setTemplates(Array.isArray(data) ? data : []);
        }
      } catch {
        // fail silently
      } finally {
        setLoadingTemplates(false);
      }
    }
    fetchTemplates();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!templateId || !customerName || !customerEmail) {
      setError('Please fill in all required fields.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId,
          customerName,
          customerEmail,
          customerPhone: customerPhone || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create proposal');
      }

      router.push('/dashboard/proposals');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-semibold text-gray-900">New Proposal</h1>
        <p className="mt-1 text-sm text-gray-500">Send a new proposal to your customer</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Template select */}
        <div>
          <label htmlFor="template" className="block text-sm font-medium text-gray-700 mb-1.5">
            Template <span className="text-red-400">*</span>
          </label>
          {loadingTemplates ? (
            <div className="h-10 w-full animate-pulse rounded-lg bg-gray-100" />
          ) : templates.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
              <FileText size={20} className="text-gray-400" />
              <p className="text-sm text-gray-500">
                No templates found. Create a template first.
              </p>
            </div>
          ) : (
            <select
              id="template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 transition-colors focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="">Select a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {formatCents(t.price)}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Template preview */}
        {selectedTemplate && (
          <div className="rounded-lg border border-teal-100 bg-teal-50/50 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-teal-800">
                {formatCents(selectedTemplate.price)}
              </span>
              <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium capitalize text-teal-700">
                {selectedTemplate.payment_type}
              </span>
            </div>
          </div>
        )}

        {/* Customer name */}
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1.5">
            Customer Name <span className="text-red-400">*</span>
          </label>
          <input
            id="name"
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Jane Smith"
            className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>

        {/* Customer email */}
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
            Email <span className="text-red-400">*</span>
          </label>
          <input
            id="email"
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            placeholder="jane@example.com"
            className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>

        {/* Customer phone */}
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1.5">
            Phone
          </label>
          <input
            id="phone"
            type="tel"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="+1 (555) 000-0000"
            className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <p className="mt-1 text-xs text-gray-400">
            If provided and GHL is connected, an SMS will be sent with the proposal link.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting || !templateId || !customerName || !customerEmail}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={16} />
            {submitting ? 'Sending…' : 'Send Proposal'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/dashboard/proposals')}
            className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
