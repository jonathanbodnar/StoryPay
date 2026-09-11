import { redirect } from 'next/navigation';

// "Bride Portal" was renamed to "Wedding Hub" (/dashboard/wedding-hub).
// Keep this stub so old bookmarks and previously-sent email links still land.
export default function BridePortalRedirect() {
  redirect('/dashboard/wedding-hub');
}
