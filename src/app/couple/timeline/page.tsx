'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Clock } from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';
import TimelineEditor from '@/components/wedding-timeline/TimelineEditor';
import { EMPTY_TIMELINE, type WeddingTimeline } from '@/lib/wedding-timeline';

function fmtDate(d: string | null): string {
  if (!d) return '';
  const parsed = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export default function CoupleTimelinePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [needsLink, setNeedsLink] = useState(false);
  const [timeline, setTimeline] = useState<WeddingTimeline>(EMPTY_TIMELINE);
  const [dateLabel, setDateLabel] = useState('');

  const load = useCallback(async () => {
    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/couple/login');
      return;
    }
    const [tRes, wRes] = await Promise.all([
      coupleAuthedFetch('/api/couple/timeline'),
      coupleAuthedFetch('/api/couple/wedding'),
    ]);
    if (tRes.status === 401) {
      router.replace('/couple/login');
      return;
    }
    if (tRes.status === 409) {
      setNeedsLink(true);
      setLoading(false);
      return;
    }
    const tData = await tRes.json().catch(() => ({}));
    if (tData.timeline) setTimeline(tData.timeline as WeddingTimeline);

    const wData = await wRes.json().catch(() => ({}));
    const wd = wData?.link?.wedding?.wedding_date ?? null;
    if (wd) setDateLabel(fmtDate(wd));

    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveTimeline(next: WeddingTimeline) {
    const res = await coupleAuthedFetch('/api/couple/timeline', {
      method: 'PUT',
      body: JSON.stringify({ timeline: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      return { ok: false, conflict: true, timeline: data.timeline as WeddingTimeline | undefined };
    }
    if (!res.ok) return { ok: false };
    return { ok: true, timeline: data.timeline as WeddingTimeline | undefined };
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
        <h1 className="font-heading text-2xl text-gray-900">Day-of timeline</h1>
        <div className="mt-8 rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
          <Clock className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-600">Connect with your venue to start your day-of timeline.</p>
          <Link
            href="/couple/wedding"
            className="mt-4 inline-flex rounded-2xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85"
          >
            Go to My wedding
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div>
        <h1 className="font-heading text-2xl text-gray-900">Day-of timeline</h1>
        <p className="mt-1 text-sm text-gray-500">
          Map out your wedding day, minute by minute. Your venue shares this same timeline, and you can download it as an
          image or PDF to send your vendors and wedding party.
        </p>
      </div>

      <div className="mt-6">
        <TimelineEditor initial={timeline} onSave={saveTimeline} dateLabel={dateLabel || undefined} />
      </div>
    </div>
  );
}
