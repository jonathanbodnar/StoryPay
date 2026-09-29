import { redirect } from 'next/navigation';

/**
 * Couple index: couples always land on the Wedding Planner home (the overview
 * with their setup checklist), on the web and in the app.
 */
export default function CoupleIndexPage() {
  redirect('/couple/wedding');
}
