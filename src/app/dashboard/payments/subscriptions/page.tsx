import { redirect } from 'next/navigation';
export default function PaymentsSubscriptionsPage() {
  redirect('/dashboard/transactions?tab=subscriptions');
}
