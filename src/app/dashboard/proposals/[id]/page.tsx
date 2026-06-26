'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Copy, ExternalLink, Receipt, RefreshCw, Wallet, Pencil,
  CheckCircle2, Circle, Loader2, FileText,
} from 'lucide-react';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';
import RecordPaymentModal, { paymentMethodLabel } from '@/components/RecordPaymentModal';

interface Proposal {
  id: string;
  proposal_number: number | null;
  status: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  price: number;
  payment_type: string;
  public_token: string;
  sent_at: string | null;
  opened_at: string | null;
  signed_at: string | null;
  paid_at: string | null;
  created_at: string;
  content: string | null;
  collect_manually?: boolean;
  require_signature?: boolean;
}

interface LedgerPayment {
  id: string;
  payment_number: number | null;
  amount_cents: number;
  method: 'cash' | 'check' | 'other' | 'cc' | 'ach';
  source?: 'manual' | 'online';
  check_number: string | null;
  note: string | null;
  paid_at: string;
}

function docNo(p: Proposal): string {
  return p.proposal_number != null ? `#${p.proposal_number}` : `#${p.id.slice(0, 8).toUpperCase()}`;
}

export default function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [ledger, setLedger] = useState<LedgerPayment[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [totalPaid, setTotalPaid] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [resending, setResending] = useState(false);
  const [recording, setRecording] = useState(false);

  async function loadProposal() {
    const res = await fetch(`/api/proposals/${id}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Not found');
    setProposal(await res.json());
  }

  async function loadPayments() {
    try {
      const res = await fetch(`/api/proposals/${id}/payments`, { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setLedger(Array.isArray(data.payments) ? data.payments : []);
        setBalance(typeof data.balance_cents === 'number' ? data.balance_cents : null);
        setTotalPaid(typeof data.total_paid_cents === 'number' ? data.total_paid_cents : 0);
      }
    } catch { /* ledger unavailable — ignore */ }
  }

  useEffect(() => {
    (async () => {
      try {
        await loadProposal();
        void loadPayments();
      } catch {
        setError('Booking not found');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function copyLink() {
    if (!proposal) return;
    navigator.clipboard.writeText(`${window.location.origin}/proposal/${proposal.public_token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function resend() {
    setResending(true);
    try {
      const res = await fetch(`/api/proposals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendNow: true }),
      });
      if (res.ok) await loadProposal();
    } finally {
      setResending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 size={22} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (!proposal) {
    return (
      <div>
        <p className="text-gray-500">{error || 'Booking not found.'}</p>
        <button onClick={() => router.push('/dashboard/payments/proposals')} className="mt-4 text-sm text-brand-900 hover:underline">
          Back to Proposals
        </button>
      </div>
    );
  }

  const statusColor = getStatusColor(proposal.status);
  const isDraft = proposal.status === 'draft';
  const effectiveBalance = balance != null ? balance : Math.max(proposal.price - totalPaid, 0);
  const hasPayments = ledger.length > 0 || totalPaid > 0;
  const requiresSignature = proposal.require_signature !== false;

  // ── Timeline steps ──────────────────────────────────────────────────────
  const steps: Array<{ label: string; date: string | null; done: boolean }> = [
    { label: 'Created', date: proposal.created_at, done: true },
    { label: 'Sent', date: proposal.sent_at, done: !!proposal.sent_at },
    { label: 'Viewed', date: proposal.opened_at, done: !!proposal.opened_at },
  ];
  if (requiresSignature) {
    steps.push({ label: 'Signed', date: proposal.signed_at, done: !!proposal.signed_at });
  }
  steps.push({
    label: totalPaid > 0 && effectiveBalance > 0 ? 'Deposit' : 'Paid',
    date: proposal.paid_at,
    done: totalPaid > 0 || proposal.status === 'paid',
  });
  if (effectiveBalance > 0 && totalPaid > 0) {
    steps.push({ label: 'Balance', date: null, done: false });
  }

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <button
        onClick={() => router.push('/dashboard/payments/proposals')}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
      >
        <ArrowLeft size={14} /> Back to Proposals
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-heading text-2xl text-gray-900">{proposal.customer_name || 'Unknown client'}</h1>
            <span className={classNames('inline-block rounded-full px-3 py-1 text-xs font-semibold capitalize', statusColor.bg, statusColor.text)}>
              {proposal.status === 'partially_paid' ? 'Partially paid' : proposal.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            <span className="font-mono">{docNo(proposal)}</span>
            {proposal.customer_email ? ` · ${proposal.customer_email}` : ''}
          </p>
        </div>
        <Link
          href={`/dashboard/proposals/${proposal.id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <Pencil size={14} /> {isDraft ? 'Edit draft' : 'Edit'}
        </Link>
      </div>

      {/* Money summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Total</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCents(proposal.price)}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Paid to date</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">{formatCents(totalPaid)}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Balance</p>
          <p className={classNames('mt-1 text-xl font-bold', effectiveBalance > 0 ? 'text-amber-600' : 'text-gray-900')}>
            {formatCents(effectiveBalance)}
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Booking timeline</h3>
        <div className="flex flex-wrap gap-y-4">
          {steps.map((s, i) => (
            <div key={s.label} className="flex items-center">
              <div className="flex flex-col items-center text-center min-w-[84px]">
                {s.done ? (
                  <CheckCircle2 size={22} className="text-emerald-500" />
                ) : (
                  <Circle size={22} className="text-gray-300" />
                )}
                <span className={classNames('mt-1.5 text-xs font-medium', s.done ? 'text-gray-900' : 'text-gray-400')}>
                  {s.label}
                </span>
                <span className="text-[11px] text-gray-400">{s.date ? formatDate(s.date) : '—'}</span>
              </div>
              {i < steps.length - 1 && (
                <div className={classNames('h-0.5 w-6 sm:w-10 -mt-6', s.done ? 'bg-emerald-200' : 'bg-gray-200')} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <button
          onClick={copyLink}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <Copy size={14} /> {copied ? 'Copied!' : 'Copy link'}
        </button>
        <Link
          href={`/proposal/${proposal.public_token}`}
          target="_blank"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <ExternalLink size={14} /> View proposal
        </Link>
        <Link
          href={`/invoice/${proposal.id}`}
          target="_blank"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <Receipt size={14} /> Invoice &amp; receipt
        </Link>
        {!isDraft && proposal.status !== 'paid' && (
          <button
            onClick={resend}
            disabled={resending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={resending ? 'animate-spin' : ''} /> {resending ? 'Resending…' : 'Resend'}
          </button>
        )}
        {proposal.collect_manually && proposal.status !== 'paid' && !isDraft && (
          <button
            onClick={() => setRecording(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-gray-800"
          >
            <Wallet size={14} /> Record payment
          </button>
        )}
      </div>

      {/* Payment ledger */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Payment ledger</h3>
          {effectiveBalance > 0 && hasPayments && (
            <span className="text-xs font-medium text-amber-600">Balance {formatCents(effectiveBalance)}</span>
          )}
        </div>
        {ledger.length === 0 ? (
          <p className="text-sm text-gray-400">No payments recorded yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {ledger.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-gray-800">
                    <span className="text-gray-400 font-normal mr-1.5">#{p.payment_number ?? '—'}</span>
                    {formatCents(p.amount_cents)}
                    <span className="text-gray-400 font-normal"> · {paymentMethodLabel(p.method, p.check_number)}</span>
                  </p>
                  <p className="text-xs text-gray-400 truncate">
                    {formatDate(p.paid_at)}{p.source === 'online' ? ' · Online' : ''}{p.note ? ` · ${p.note}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Document / contract */}
      {proposal.content && (
        <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={15} className="text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">Document</h3>
          </div>
          <div
            className="prose prose-sm max-w-none text-gray-700"
            dangerouslySetInnerHTML={{ __html: proposal.content }}
          />
        </div>
      )}

      {recording && (
        <RecordPaymentModal
          proposal={{ id: proposal.id, customer_name: proposal.customer_name, customer_email: proposal.customer_email, price: proposal.price }}
          onClose={() => setRecording(false)}
          onSaved={() => { void loadPayments(); void loadProposal(); }}
        />
      )}
    </div>
  );
}
