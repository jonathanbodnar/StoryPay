'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, FileText, Pencil } from 'lucide-react';
import { formatCents, formatDate } from '@/lib/utils';

interface Template {
  id: string;
  name: string;
  price: number;
  payment_type: string;
  field_count: number;
  created_at: string;
}

const paymentLabel: Record<string, string> = {
  full: 'Full Payment',
  installment: 'Installment',
  subscription: 'Subscription',
};

const paymentBadgeColor: Record<string, string> = {
  full: 'bg-teal-100 text-teal-700',
  installment: 'bg-amber-100 text-amber-700',
  subscription: 'bg-indigo-100 text-indigo-700',
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/templates')
      .then((r) => r.json())
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-heading text-2xl font-semibold text-gray-900">Templates</h1>
        <Link
          href="/dashboard/proposals/templates/new"
          className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-teal-600 transition-colors"
        >
          <Plus size={16} />
          Create Template
        </Link>
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400">Loading templates…</div>
      ) : templates.length === 0 ? (
        <div className="py-16 text-center">
          <FileText size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500">No templates yet. Create your first proposal template to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-gray-200 bg-white p-5 flex flex-col justify-between hover:shadow-md transition-shadow"
            >
              <div>
                <h3 className="font-heading text-lg font-semibold text-gray-900 mb-1">
                  {t.name}
                </h3>
                <p className="text-xl font-bold text-gray-800 mb-3">
                  {formatCents(t.price)}
                </p>
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${paymentBadgeColor[t.payment_type] ?? 'bg-gray-100 text-gray-700'}`}
                  >
                    {paymentLabel[t.payment_type] ?? t.payment_type}
                  </span>
                  <span className="text-xs text-gray-400">
                    {t.field_count} field{t.field_count !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">{formatDate(t.created_at)}</span>
                <Link
                  href={`/dashboard/proposals/templates/${t.id}/edit`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <Pencil size={12} />
                  Edit
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
