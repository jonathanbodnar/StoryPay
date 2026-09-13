'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, ListChecks } from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';
import ChecklistEditor from '@/components/wedding-checklist/ChecklistEditor';
import { EMPTY_CHECKLIST, type WeddingChecklist } from '@/lib/wedding-checklist';

export default function CoupleChecklistPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [needsLink, setNeedsLink] = useState(false);
  const [checklist, setChecklist] = useState<WeddingChecklist>(EMPTY_CHECKLIST);
  const [weddingDate, setWeddingDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/couple/login');
      return;
    }
    const [cRes, wRes] = await Promise.all([
      coupleAuthedFetch('/api/couple/checklist'),
      coupleAuthedFetch('/api/couple/wedding'),
    ]);
    if (cRes.status === 401) {
      router.replace('/couple/login');
      return;
    }
    if (cRes.status === 409) {
      setNeedsLink(true);
      setLoading(false);
      return;
    }
    const cData = await cRes.json().catch(() => ({}));
    if (cData.checklist) setChecklist(cData.checklist as WeddingChecklist);

    const wData = await wRes.json().catch(() => ({}));
    setWeddingDate(wData?.link?.wedding?.wedding_date ?? null);

    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveChecklist(next: WeddingChecklist) {
    const res = await coupleAuthedFetch('/api/couple/checklist', {
      method: 'PUT',
      body: JSON.stringify({ checklist: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) return { ok: false, conflict: true, checklist: data.checklist as WeddingChecklist | undefined };
    if (!res.ok) return { ok: false };
    return { ok: true, checklist: data.checklist as WeddingChecklist | undefined };
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
        <h1 className="font-heading text-2xl text-gray-900">Checklist</h1>
        <div className="mt-8 rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
          <ListChecks className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-600">Connect with your venue to start your planning checklist.</p>
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
        <h1 className="font-heading text-2xl text-gray-900">Checklist</h1>
        <p className="mt-1 text-sm text-gray-500">
          Stay on track with everything you need to plan. Your venue shares this checklist and can help you check things
          off.
        </p>
      </div>
      <div className="mt-6">
        <ChecklistEditor initial={checklist} onSave={saveChecklist} weddingDate={weddingDate} audience="couple" />
      </div>
    </div>
  );
}
