'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, CheckCircle2, KeyRound } from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';

type Profile = {
  first_name: string | null;
  last_name: string | null;
  partner_first_name: string | null;
  partner_last_name: string | null;
  guest_count: number | null;
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
  'w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200';
const INPUT_REQUIRED_MISSING = 'border-red-300 focus:border-red-400 focus:ring-red-200';
const LABEL = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';
const REQUIRED_DOT = <span className="text-red-500 ml-0.5">*</span>;

export default function CoupleProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedFlash, setSavedFlash] = useState('');
  const [email, setEmail] = useState('');
  const [originalEmail, setOriginalEmail] = useState('');

  // Password change (uses the logged-in couple session).
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwFlash, setPwFlash] = useState('');
  const [form, setForm] = useState<Profile>({
    first_name: null,
    last_name: null,
    partner_first_name: null,
    partner_last_name: null,
    guest_count: null,
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
    const userEmail = session.user.email ?? '';
    setEmail(userEmail);
    setOriginalEmail(userEmail);
    const res = await coupleAuthedFetch('/api/couple/me');
    if (res.status === 401) {
      router.replace('/couple/login');
      return;
    }
    const data = await res.json().catch(() => ({}));
    const p = data.profile;
    if (p && typeof p === 'object') {
      // If the schema doesn't yet have first/last name, attempt to derive
      // them from display_name so the form has sensible initial values.
      let firstFromMeta: string | null = p.first_name ?? null;
      let lastFromMeta: string | null = p.last_name ?? null;
      if (!firstFromMeta && !lastFromMeta && p.display_name) {
        const parts = String(p.display_name).trim().split(/\s+/);
        firstFromMeta = parts[0] || null;
        lastFromMeta = parts.slice(1).join(' ') || null;
      }
      setForm({
        first_name: firstFromMeta,
        last_name: lastFromMeta,
        partner_first_name: p.partner_first_name ?? null,
        partner_last_name: p.partner_last_name ?? null,
        guest_count: typeof p.guest_count === 'number' ? p.guest_count : null,
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

  const requiredMissing = {
    first_name: !form.first_name?.trim(),
    last_name: !form.last_name?.trim(),
    phone: !form.phone?.trim(),
    email: !email.trim() || !email.includes('@'),
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSavedFlash('');

    if (requiredMissing.first_name) { setError('First name is required.'); return; }
    if (requiredMissing.last_name) { setError('Last name is required.'); return; }
    if (requiredMissing.email) { setError('A valid email is required.'); return; }
    if (requiredMissing.phone) { setError('Phone number is required.'); return; }

    setSaving(true);
    try {
      const payload = { ...form, email };
      const res = await coupleAuthedFetch('/api/couple/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Save failed');
        return;
      }
      if (data.profile && typeof data.profile === 'object') {
        const p = data.profile as Record<string, unknown>;
        setForm((prev) => ({
          ...prev,
          first_name: (p.first_name as string | null) ?? prev.first_name,
          last_name: (p.last_name as string | null) ?? prev.last_name,
          partner_first_name: (p.partner_first_name as string | null) ?? prev.partner_first_name,
          partner_last_name: (p.partner_last_name as string | null) ?? prev.partner_last_name,
          guest_count: typeof p.guest_count === 'number' ? (p.guest_count as number) : prev.guest_count,
          display_name: (p.display_name as string | null) ?? prev.display_name,
          phone: (p.phone as string | null) ?? prev.phone,
          address_line1: (p.address_line1 as string | null) ?? prev.address_line1,
          address_line2: (p.address_line2 as string | null) ?? prev.address_line2,
          city: (p.city as string | null) ?? prev.city,
          state: (p.state as string | null) ?? prev.state,
          postal_code: (p.postal_code as string | null) ?? prev.postal_code,
          country: (p.country as string | null) ?? prev.country,
          instagram_url: (p.instagram_url as string | null) ?? prev.instagram_url,
          facebook_url: (p.facebook_url as string | null) ?? prev.facebook_url,
          tiktok_url: (p.tiktok_url as string | null) ?? prev.tiktok_url,
          pinterest_url: (p.pinterest_url as string | null) ?? prev.pinterest_url,
          wedding_date: (p.wedding_date as string | null) ?? prev.wedding_date,
        }));
      }
      if (typeof data.email === 'string') {
        setEmail(data.email);
        setOriginalEmail(data.email);
      }
      setSavedFlash('Profile saved.');
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    setPwFlash('');
    if (pw.length < 8) { setPwError('Use at least 8 characters.'); return; }
    if (pw !== pw2) { setPwError('Passwords do not match.'); return; }
    setPwSaving(true);
    try {
      const supabase = getCoupleSupabase();
      const { error: pwErr } = await supabase.auth.updateUser({ password: pw });
      if (pwErr) {
        setPwError(pwErr.message || 'Could not update password.');
        return;
      }
      setPw('');
      setPw2('');
      setPwFlash('Password updated.');
    } finally {
      setPwSaving(false);
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
      <p className="mt-1 text-sm text-gray-500">
        Required fields are marked with a red asterisk. Your name, email, and phone are needed for venues to reach you.
      </p>

      <form onSubmit={(e) => void onSubmit(e)} className="mt-8 max-w-xl space-y-5">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        )}
        {savedFlash && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 flex items-center gap-2">
            <CheckCircle2 size={14} /> {savedFlash}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>First name{REQUIRED_DOT}</label>
            <input
              type="text"
              required
              autoComplete="given-name"
              className={`${INPUT} ${requiredMissing.first_name ? INPUT_REQUIRED_MISSING : ''}`}
              value={form.first_name ?? ''}
              onChange={(e) => set('first_name', e.target.value || null)}
            />
          </div>
          <div>
            <label className={LABEL}>Last name{REQUIRED_DOT}</label>
            <input
              type="text"
              required
              autoComplete="family-name"
              className={`${INPUT} ${requiredMissing.last_name ? INPUT_REQUIRED_MISSING : ''}`}
              value={form.last_name ?? ''}
              onChange={(e) => set('last_name', e.target.value || null)}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Partner&rsquo;s first name</label>
            <input
              type="text"
              className={INPUT}
              value={form.partner_first_name ?? ''}
              onChange={(e) => set('partner_first_name', e.target.value || null)}
              placeholder="Alex"
            />
          </div>
          <div>
            <label className={LABEL}>Partner&rsquo;s last name</label>
            <input
              type="text"
              className={INPUT}
              value={form.partner_last_name ?? ''}
              onChange={(e) => set('partner_last_name', e.target.value || null)}
              placeholder="Rivera"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Email{REQUIRED_DOT}</label>
            <input
              type="email"
              required
              autoComplete="email"
              className={`${INPUT} ${requiredMissing.email ? INPUT_REQUIRED_MISSING : ''}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {email !== originalEmail && (
              <p className="mt-1 text-[11px] text-amber-600">
                Saving will change your login email.
              </p>
            )}
          </div>
          <div>
            <label className={LABEL}>Phone{REQUIRED_DOT}</label>
            <input
              type="tel"
              required
              autoComplete="tel"
              className={`${INPUT} ${requiredMissing.phone ? INPUT_REQUIRED_MISSING : ''}`}
              value={form.phone ?? ''}
              onChange={(e) => set('phone', e.target.value || null)}
              placeholder="(555) 123-4567"
            />
          </div>
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

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Wedding date</label>
            <input
              type="date"
              className={INPUT}
              value={form.wedding_date ?? ''}
              onChange={(e) => set('wedding_date', e.target.value || null)}
            />
          </div>
          <div>
            <label className={LABEL}>Estimated guest count</label>
            <input
              type="number"
              min={0}
              max={2000}
              className={INPUT}
              value={form.guest_count ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                set('guest_count', v === '' ? null : Math.max(0, Math.min(2000, Number(v) || 0)));
              }}
              placeholder="e.g. 120"
            />
            <p className="mt-1 text-[11px] text-gray-400">Roughly how many guests you expect — helps your venue plan.</p>
          </div>
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
          className="rounded-2xl bg-[#1b1b1b] px-6 py-3 text-sm font-medium text-white hover:opacity-85 transition-opacity disabled:opacity-60"
        >
          {saving ? <Loader2 className="inline h-4 w-4 animate-spin mr-1" /> : null} Save profile
        </button>
      </form>

      {/* Password */}
      <form onSubmit={(e) => void changePassword(e)} className="mt-10 max-w-xl border-t border-gray-100 pt-8 space-y-5">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Password</h2>
        </div>
        <p className="-mt-2 text-xs text-gray-400">Set or change the password you use to log in.</p>

        {pwError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{pwError}</div>
        )}
        {pwFlash && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <CheckCircle2 size={14} /> {pwFlash}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>New password</label>
            <input
              type="password"
              autoComplete="new-password"
              className={INPUT}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label className={LABEL}>Confirm new password</label>
            <input
              type="password"
              autoComplete="new-password"
              className={INPUT}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={pwSaving || !pw || !pw2}
          className="rounded-2xl border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors disabled:opacity-60"
        >
          {pwSaving ? <Loader2 className="inline h-4 w-4 animate-spin mr-1" /> : null} Update password
        </button>
      </form>
    </div>
  );
}
