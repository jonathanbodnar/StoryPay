import { redirect } from 'next/navigation';

// Legacy products page — unified into /dashboard/offerings.
export default function ProductsLegacyRedirect() {
  redirect('/dashboard/offerings');
}
