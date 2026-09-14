import { redirect } from 'next/navigation';

// Renamed to "Favorites" — keep the old path working for bookmarks and any
// existing post-auth redirects that still point at /couple/dashboard.
export default function CoupleDashboardRedirect() {
  redirect('/couple/favorites');
}
