'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Contact } from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';
import VendorDirectory from '@/components/wedding-vendors/VendorDirectory';
import { EMPTY_VENDORS, type WeddingVendors } from '@/lib/wedding-vendors';

export default function CoupleVendorsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [needsLink, setNeedsLink] = useState(false);
  const [vendors, setVendors] = useState<WeddingVendors>(EMPTY_VENDORS);

  const load = useCallback(async () => {
    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/couple/login');
      return;
    }
    const res = await coupleAuthedFetch('/api/couple/vendors');
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
    if (data.vendors) setVendors(data.vendors as WeddingVendors);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveVendors(next: WeddingVendors) {
    const res = await coupleAuthedFetch('/api/couple/vendors', {
      method: 'PUT',
      body: JSON.stringify({ vendors: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) return { ok: false, conflict: true, vendors: data.vendors as WeddingVendors | undefined };
    if (!res.ok) return { ok: false };
    return { ok: true, vendors: data.vendors as WeddingVendors | undefined };
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
        <h1 className="font-heading text-2xl text-gray-900">Vendors</h1>
        <div className="mt-8 rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
          <Contact className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-600">Connect with your venue to build your vendor directory.</p>
          <Link
            href="/couple/wedding"
            className="mt-4 inline-flex rounded-2xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85"
          >
            Go to Wedding Hub
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div>
        <h1 className="font-heading text-2xl text-gray-900">Vendors</h1>
        <p className="mt-1 text-sm text-gray-500">
          Keep all your wedding vendors in one place. Your venue can see this list too, so everyone has the day-of
          contacts they need.
        </p>
      </div>
      <div className="mt-6">
        <VendorDirectory initial={vendors} onSave={saveVendors} audience="couple" />
      </div>
    </div>
  );
}
