'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download } from 'lucide-react';

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 90);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default function AccountingExportPage() {
  const d = useMemo(() => defaultRange(), []);
  const [from, setFrom] = useState(d.from);
  const [to, setTo] = useState(d.to);

  const downloadUrl = useCallback(() => {
    const p = new URLSearchParams({ from, to });
    return `/api/accounting/export?${p.toString()}`;
  }, [from, to]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link
        href="/dashboard/transactions"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft size={16} />
        Transactions
      </Link>
      <h1 className="text-2xl font-bold text-gray-900">Accounting export</h1>
      <p className="mt-2 text-sm text-gray-600">
        Download a CSV of paid proposals and refunds for your bookkeeper. Posting dates use paid time for payments
        and last update time for refunds (full refund rows are negative amounts).
      </p>

      <div className="mt-8 space-y-4 rounded-2xl border border-gray-200 bg-white p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <a
          href={downloadUrl()}
          className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          <Download size={16} />
          Download CSV
        </a>
      </div>
    </div>
  );
}
