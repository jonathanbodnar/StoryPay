import { redirect } from 'next/navigation';

// "Bride Portal" was renamed to "Wedding Planner" (/dashboard/wedding-planner).
// Keep this stub so old bookmarks and previously-sent email links still land.
export default function BridePortalRedirect() {
  redirect('/dashboard/wedding-planner');
}
