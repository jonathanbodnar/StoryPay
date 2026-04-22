import { redirect } from 'next/navigation';

// The old Products page has been unified into /dashboard/offerings.
// Keep this route as a redirect so existing bookmarks and links still work.
export default function PaymentsProductsRedirect() {
  redirect('/dashboard/offerings');
}
