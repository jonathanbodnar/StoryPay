'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Copy, ExternalLink, Plus } from 'lucide-react';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';

interface Proposal {
  id: string;
  customer_name: string;
  customer_email: string;
  status: string;
  price: number;
  payment_type: string;
  public_token: string;
  sent_at: string | null;
  created_at: string;
}

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProposals() {
      try {
        const res = await fetch('/api/proposals');
        if (res.ok) {
          const data = await res.json();
          setProposals(Array.isArray(data) ? data : []);
        }
      } catch {
        // fail silently
      } finally {
        setLoading(false);
      }
    }
    fetchProposals();
  }, []);

  function copyLink(proposal: Proposal) {
    const url = `${window.location.origin}/proposal/${proposal.public_token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(proposal.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-gray-900">Proposals</h1>
          <p className="mt-1 text-sm text-gray-500">Manage and track your proposals</p>
        </div>
        <Link
          href="/dashboard/proposals/new"
          className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-600"
        >
          <Plus size={16} />
          New Proposal
        </Link>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Customer
              </th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Status
              </th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Amount
              </th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Payment Type
              </th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Sent
              </th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  <td className="px-5 py-4"><div className="h-4 w-32 animate-pulse rounded bg-gray-100" /></td>
                  <td className="px-5 py-4"><div className="h-5 w-16 animate-pulse rounded-full bg-gray-100" /></td>
                  <td className="px-5 py-4"><div className="h-4 w-20 animate-pulse rounded bg-gray-100" /></td>
                  <td className="px-5 py-4"><div className="h-4 w-20 animate-pulse rounded bg-gray-100" /></td>
                  <td className="px-5 py-4"><div className="h-4 w-24 animate-pulse rounded bg-gray-100" /></td>
                  <td className="px-5 py-4"><div className="h-4 w-16 animate-pulse rounded bg-gray-100" /></td>
                </tr>
              ))
            ) : proposals.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-16 text-center">
                  <FileText size={40} className="mx-auto mb-3 text-gray-300" />
                  <p className="text-sm font-medium text-gray-500">No proposals yet</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Create your first proposal to get started
                  </p>
                </td>
              </tr>
            ) : (
              proposals.map((p) => {
                const color = getStatusColor(p.status);
                return (
                  <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-gray-900">{p.customer_name}</div>
                      <div className="text-xs text-gray-400">{p.customer_email}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={classNames(
                          'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                          color.bg,
                          color.text
                        )}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-700">{formatCents(p.price)}</td>
                    <td className="px-5 py-3.5 text-gray-700 capitalize">{p.payment_type}</td>
                    <td className="px-5 py-3.5 text-gray-500">
                      {p.sent_at ? formatDate(p.sent_at) : '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => copyLink(p)}
                          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                          title="Copy proposal link"
                        >
                          <Copy size={14} />
                          {copiedId === p.id ? 'Copied!' : 'Copy Link'}
                        </button>
                        <Link
                          href={`/proposal/${p.public_token}`}
                          target="_blank"
                          className="inline-flex items-center rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                          title="View proposal"
                        >
                          <ExternalLink size={14} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
