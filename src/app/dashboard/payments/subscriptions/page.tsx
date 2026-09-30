import { redirect } from 'next/navigation';

// Recurring subscriptions were retired: payment plans (a deposit, then
// payments charged automatically on set dates) replace them.
export default function SubscriptionsPage() {
  redirect('/dashboard/payments/installments');
}
