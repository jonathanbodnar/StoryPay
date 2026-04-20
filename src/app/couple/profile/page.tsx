'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';

type Profile = {
  display_name: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  tiktok_url: string | null;
  pinterest_url: string | null;
  wedding_date: string | null;
};

const INPUT =
  'w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400';
const LABEL = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';

export default function CoupleProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [form, setForm] = useState<Profile>({
    display_name: null,
    phone: null,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    country: 'US',
    instagram_url: null,
    facebook_url: null,
    tiktok_url: null,
    pinterest_url: null,
    wedding_date: null,
  });

  const load = useCallback(async () => {
    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/couple/login');
      return;
    }
    setEmail(session.user.email ?? '');
    const res = await coupleAuthedFetch('/api/couple/me');
    if (res.status === 401) {
      router.replace('/couple/login');
      return;
    }
    const data = await res.json().catch(() => ({}));
    const p = data.profile;
    if (p && typeof p === 'object') {
      setForm({
        display_name: p.display_name ?? null,
        phone: p.phone ?? null,
        address_line1: p.address_line1 ?? null,
        address_line2: p.address_line2 ?? null,
        city: p.city ?? null,
        state: p.state ?? null,
        postal_code: p.postal_code ?? null,
        country: p.country ?? 'US',
        instagram_url: p.instagram_url ?? null,
        facebook_url: p.facebook_url ?? null,
        tiktok_url: p.tiktok_url ?? null,
        pinterest_url: p.pinterest_url ?? null,
        wedding_date: p.wedding_date ?? null,
      });
    }
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await coupleAuthedFetch('/api/couple/profile', {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Save failed');
        return;
      }
      if (data.profile && typeof data.profile === 'object') {
        const p = data.profile as Record<string, unknown>;
        setForm({
          display_name: (p.display_name as string | null) ?? null,
          phone: (p.phone as string | null) ?? null,
          address_line1: (p.address_line1 as string | null) ?? null,
          address_line2: (p.address_line2 as string | null) ?? null,
          city: (p.city as string | null) ?? null,
          state: (p.state as string | null) ?? null,
          postal_code: (p.postal_code as string | null) ?? null,
          country: (p.country as string | null) ?? 'US',
          instagram_url: (p.instagram_url as string | null) ?? null,
          facebook_url: (p.facebook_url as string | null) ?? null,
          tiktok_url: (p.tiktok_url as string | null) ?? null,
          pinterest_url: (p.pinterest_url as string | null) ?? null,
          wedding_date: (p.wedding_date as string | null) ?? null,
        });
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-heading text-2xl text-gray-900">Your profile</h1>
      <p className="mt-1 text-sm text-gray-500">Contact info and social links for your wedding planning.</p>

      <form onSubmit={(e) => void onSubmit(e)} className="mt-8 max-w-xl space-y-5">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        )}

        <div>
          <label className={LABEL}>Email</label>
          <input type="email" className={`${INPUT} bg-gray-50`} value={email} disabled readOnly />
        </div>

        <div>
          <label className={LABEL}>Names</label>
          <input
            type="text"
            className={INPUT}
            value={form.display_name ?? ''}
            onChange={(e) => set('display_name', e.target.value || null)}
            placeholder="Alex & Jordan"
          />
        </div>

        <div>
          <label className={LABEL}>Phone</label>
          <input
            type="tel"
            className={INPUT}
            value={form.phone ?? ''}
            onChange={(e) => set('phone', e.target.value || null)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={LABEL}>Address line 1</label>
            <input
              type="text"
              className={INPUT}
              value={form.address_line1 ?? ''}
              onChange={(e) => set('address_line1', e.target.value || null)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Address line 2</label>
            <input
              type="text"
              className={INPUT}
              value={form.address_line2 ?? ''}
              onChange={(e) => set('address_line2', e.target.value || null)}
            />
          </div>
          <div>
            <label className={LABEL}>City</label>
            <input type="text" className={INPUT} value={form.city ?? ''} onChange={(e) => set('city', e.target.value || null)} />
          </div>
          <div>
            <label className={LABEL}>State</label>
            <input type="text" className={INPUT} value={form.state ?? ''} onChange={(e) => set('state', e.target.value || null)} />
          </div>
          <div>
            <label className={LABEL}>Postal code</label>
            <input
              type="text"
              className={INPUT}
              value={form.postal_code ?? ''}
              onChange={(e) => set('postal_code', e.target.value || null)}
            />
          </div>
          <div>
            <label className={LABEL}>Country</label>
            <input type="text" className={INPUT} value={form.country ?? ''} onChange={(e) => set('country', e.target.value || null)} />
          </div>
        </div>

        <div>
          <label className={LABEL}>Wedding date</label>
          <input
            type="date"
            className={INPUT}
            value={form.wedding_date ?? ''}
            onChange={(e) => set('wedding_date', e.target.value || null)}
          />
        </div>

        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Social (https://)</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(['instagram_url', 'facebook_url', 'tiktok_url', 'pinterest_url'] as const).map((key) => (
            <div key={key}>
              <label className={LABEL}>{key.replace('_url', '').replace('_', ' ')}</label>
              <input
                type="url"
                className={INPUT}
                value={form[key] ?? ''}
                onChange={(e) => set(key, e.target.value || null)}
                placeholder="https://"
              />
            </div>
          ))}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-2xl bg-[#1b1b1b] px-6 py-3 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? <Loader2 className="inline h-4 w-4 animate-spin" /> : null} Save profile
        </button>
      </form>
    </div>
  );
}
