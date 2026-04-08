'use client';

import { Link2, Plus } from 'lucide-react';
import Link from 'next/link';

export default function PaymentLinksPage() {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="font-heading text-2xl text-gray-900">Payment Links</h1>
          <p className="mt-1 text-sm text-gray-500">Create shareable payment links for quick checkout</p>
        </div>
        <button
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-all shadow-sm"
          style={{ backgroundColor: '#293745' }}
        >
          <Plus size={15} /> Create Payment Link
        </button>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="py-16 text-center">
          <Link2 size={40} className="mx-auto mb-4 text-gray-200" />
          <p className="text-sm font-medium text-gray-500">No payment links yet</p>
          <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
            Payment links let you accept one-time payments without a full proposal or invoice.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/dashboard/invoices/new"
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              Create an Invoice instead
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
