'use client';

import { DollarSign } from 'lucide-react';

export default function PayoutsPage() {
 return (
 <div>
 <div className="mb-8">
 <h1 className="font-heading text-2xl text-gray-900">Payouts</h1>
 <p className="mt-1 text-sm text-gray-500">View your payout history and schedule</p>
 </div>

 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="py-16 text-center">
 <DollarSign size={40} className="mx-auto mb-4 text-gray-200"/>
 <p className="text-sm font-medium text-gray-500">Payouts are managed by LunarPay</p>
 <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto leading-relaxed">
 Your earnings are automatically transferred to your bank account on your payout schedule. Log in to your LunarPay merchant portal to view payout history and settings.
 </p>
 <a
 href="https://app.lunarpay.com"
 target="_blank"
 rel="noreferrer"
 className="mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-all"
 style={{ backgroundColor: '#1b1b1b' }}
 >
 Open LunarPay Portal
 </a>
 </div>
 </div>
 </div>
 );
}
