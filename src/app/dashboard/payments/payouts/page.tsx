'use client';

import { useEffect, useState } from 'react';
import { DollarSign } from 'lucide-react';
import PaymentGate from '@/components/PaymentGate';

function PayoutsInner() {
 // Venues on Stripe manage payouts in their own Stripe dashboard.
 const [provider, setProvider] = useState<'stripe' | 'lunarpay' | null>(null);
 useEffect(() => {
   fetch('/api/lunarpay/active', { cache: 'no-store' })
     .then((r) => (r.ok ? r.json() : null))
     .then((d: { provider?: 'stripe' | 'lunarpay' | null } | null) => setProvider(d?.provider === 'stripe' ? 'stripe' : 'lunarpay'))
     .catch(() => setProvider('lunarpay'));
 }, []);
 const onStripe = provider === 'stripe';

 return (
 <div>
 <div className="mb-8">
 <h1 className="font-heading text-2xl text-gray-900">Payouts</h1>
 <p className="mt-1 text-sm text-gray-500">View your payout history and schedule</p>
 </div>

 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 {provider && (
 <div className="py-16 text-center">
 <DollarSign size={40} className="mx-auto mb-4 text-gray-200"/>
 <p className="text-sm font-medium text-gray-500">
   {onStripe ? 'Payouts are managed in your Stripe account' : 'Payouts are managed by StoryPay’s merchant platform'}
 </p>
 <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto leading-relaxed">
   {onStripe
     ? 'Stripe sends your earnings to your bank account automatically, usually within 2 business days. Your Stripe dashboard shows every payout, its schedule and your bank settings.'
     : 'Your earnings are automatically transferred to your bank account on your StoryPay payout schedule. Log in to your StoryPay merchant portal to view payout history and bank settings.'}
 </p>
 <a
 href={onStripe ? 'https://dashboard.stripe.com/payouts' : 'https://app.lunarpay.com'}
 target="_blank"
 rel="noreferrer"
 className="mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-all"
 style={{ backgroundColor: '#1b1b1b' }}
 >
 {onStripe ? 'Open your Stripe payouts' : 'Open StoryPay merchant portal'}
 </a>
 </div>
 )}
 </div>
 </div>
 );
}

// Payouts are a StoryPay feature, so the page follows the same pause gate as
// the other payment surfaces.
export default function PayoutsPage() {
  return <PaymentGate><PayoutsInner /></PaymentGate>;
}
