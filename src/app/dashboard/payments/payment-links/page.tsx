import { redirect } from 'next/navigation';

// Payment links were never built; an invoice is how a venue asks for a
// one-off payment (it's paid right from its link), so send venues there.
export default function PaymentLinksPage() {
  redirect('/dashboard/payments/new?type=invoice');
}
