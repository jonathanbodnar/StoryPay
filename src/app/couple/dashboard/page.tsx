import { redirect } from 'next/navigation';

// Old path (it was the Favorites list). Couples' home is the Wedding Planner
// overview, so bookmarks and any old post-login links land there.
export default function CoupleDashboardRedirect() {
  redirect('/couple/wedding');
}
