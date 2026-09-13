'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';
import BudgetTracker from '@/components/wedding-budget/BudgetTracker';
import { EMPTY_BUDGET, type WeddingBudget } from '@/lib/wedding-budget';

export default function CoupleBudgetPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [needsLink, setNeedsLink] = useState(false);
  const [budget, setBudget] = useState<WeddingBudget>(EMPTY_BUDGET);

  const load = useCallback(async () => {
    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/couple/login');
      return;
    }
    const res = await coupleAuthedFetch('/api/couple/budget');
    if (res.status === 401) {
      router.replace('/couple/login');
      return;
    }
    if (res.status === 409) {
      setNeedsLink(true);
      setLoading(false);
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (data.budget) setBudget(data.budget as WeddingBudget);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveBudget(next: WeddingBudget) {
    const res = await coupleAuthedFetch('/api/couple/budget', {
      method: 'PUT',
      body: JSON.stringify({ budget: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) return { ok: false, conflict: true, budget: data.budget as WeddingBudget | undefined };
    if (!res.ok) return { ok: false };
    return { ok: true, budget: data.budget as WeddingBudget | undefined };
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (needsLink) {
    return (
      <div>
        <h1 className="font-heading text-2xl text-gray-900">Budget</h1>
        <div className="mt-8 rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
          <Wallet className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-600">Connect with your venue to start tracking your budget.</p>
          <Link
            href="/couple/wedding"
            className="mt-4 inline-flex rounded-2xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85"
          >
            Go to Wedding Planner
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div>
        <h1 className="font-heading text-2xl text-gray-900">Budget</h1>
        <p className="mt-1 text-sm text-gray-500">
          Track what you plan to spend versus what you actually spend. This is private to you — your venue can&apos;t see
          it.
        </p>
      </div>
      <div className="mt-6">
        <BudgetTracker initial={budget} onSave={saveBudget} />
      </div>
    </div>
  );
}
