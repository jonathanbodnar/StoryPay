'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Copy, ExternalLink, Plus, Pencil, Trash2, Send, FileStack, RefreshCw } from 'lucide-react';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';

interface Proposal {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
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
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    fetchProposals();
  }, []);

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

  function copyLink(proposal: Proposal) {
    const url = `${window.location.origin}/proposal/${proposal.public_token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(proposal.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleQuickSend(proposal: Proposal) {
    if (!proposal.customer_name || !proposal.customer_email) {
      alert('This draft needs a customer name and email before sending. Edit it first.');
      return;
    }
    if (!proposal.price || proposal.price <= 0) {
      alert('This draft needs a valid price before sending. Edit it first.');
      return;
    }

    setSendingId(proposal.id);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendNow: true }),
      });
      if (res.ok) {
        await fetchProposals();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to send');
      }
    } catch {
      alert('Failed to send proposal');
    } finally {
      setSendingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this draft? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/proposals/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setProposals((prev) => prev.filter((p) => p.id !== id));
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete');
      }
    } catch {
      alert('Failed to delete');
    }
  }

  async function handleResend(proposal: Proposal) {
    setSendingId(proposal.id);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendNow: true }),
      });
      if (res.ok) {
        alert('Proposal resent successfully.');
        await fetchProposals();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to resend');
      }
    } catch {
      alert('Failed to resend proposal');
    } finally {
      setSendingId(null);
    }
  }

  const drafts = proposals.filter((p) => p.status === 'draft');
  const sent = proposals.filter((p) => p.status !== 'draft');

  return (
    <div>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gray-900">Proposals</h1>
          <p className="mt-1 text-sm text-gray-500">Manage and track your proposals</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/proposals/templates"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <FileStack size={16} />
            Templates
          </Link>
          <Link
            href="/dashboard/proposals/new"
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: '#293745' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2f3e4e')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#293745')}
          >
            <Plus size={16} />
            New Proposal
          </Link>
        </div>
      </div>

      {/* Drafts section */}
      {drafts.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Drafts ({drafts.length})
          </h2>
          <div className="space-y-2">
            {drafts.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-5 py-4 transition-colors hover:bg-gray-50"
              >
                <div className="flex items-center gap-4">
                  <span className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                    Draft
                  </span>
                  <div>
                    <Link
                      href={`/dashboard/proposals/${p.id}/edit`}
                      className="text-sm font-medium text-gray-900 hover:text-brand-900 hover:underline"
                    >
                      {p.customer_name || 'No customer yet'}
                    </Link>
                    {p.customer_email && (
                      <span className="ml-2 text-xs text-gray-400">{p.customer_email}</span>
                    )}
                  </div>
                  {p.price > 0 && (
                    <span className="text-sm text-gray-500">{formatCents(p.price)}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Link
                    href={`/dashboard/proposals/${p.id}/edit`}
                    className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200"
                  >
                    <Pencil size={13} />
                    Edit
                  </Link>
                  <button
                    onClick={() => handleQuickSend(p)}
                    disabled={sendingId === p.id}
                    className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-brand-900 transition-colors hover:bg-brand-900/5 disabled:opacity-50"
                  >
                    <Send size={13} />
                    {sendingId === p.id ? 'Sending...' : 'Send'}
                  </button>
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="inline-flex items-center rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                    title="Delete draft"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sent proposals table */}
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
            ) : sent.length === 0 && drafts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-16 text-center">
                  <FileText size={40} className="mx-auto mb-3 text-gray-300" />
                  <p className="text-sm font-medium text-gray-500">No proposals yet</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Create your first proposal to get started
                  </p>
                </td>
              </tr>
            ) : sent.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center">
                  <p className="text-sm text-gray-400">No sent proposals yet</p>
                </td>
              </tr>
            ) : (
              sent.map((p) => {
                const color = getStatusColor(p.status);
                return (
                  <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/dashboard/proposals/${p.id}/edit`}
                        className="block"
                      >
                        <span className="font-medium text-gray-900 hover:text-brand-900 hover:underline">
                          {p.customer_name}
                        </span>
                        <div className="text-xs text-gray-400">{p.customer_email}</div>
                      </Link>
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
                      {p.sent_at ? formatDate(p.sent_at) : '---'}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1">
                        <Link
                          href={`/dashboard/proposals/${p.id}/edit`}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                          title="Edit proposal"
                        >
                          <Pencil size={13} />
                        </Link>
                        <button
                          onClick={() => handleResend(p)}
                          disabled={sendingId === p.id}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
                          title="Resend proposal"
                        >
                          <RefreshCw size={13} className={sendingId === p.id ? 'animate-spin' : ''} />
                        </button>
                        <button
                          onClick={() => copyLink(p)}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                          title="Copy proposal link"
                        >
                          <Copy size={14} />
                          {copiedId === p.id ? 'Copied!' : ''}
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
