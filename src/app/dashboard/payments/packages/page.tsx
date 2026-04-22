import { redirect } from 'next/navigation';

// The old Packages page has been unified into /dashboard/offerings.
// Keep this route as a redirect so existing bookmarks and links still work.
export default function PaymentsPackagesRedirect() {
  redirect('/dashboard/offerings');
}
