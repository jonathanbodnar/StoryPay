import { redirect } from 'next/navigation';

/**
 * /login/ghl — the old "open from GoHighLevel" link. It used to sign venues in
 * by their CRM location ID, which anyone could supply, so it now sends
 * everyone to the normal login (email and password, or an emailed login link).
 * Kept as a redirect so existing CRM menu links don't break.
 */
export default function GHLLoginPage() {
  redirect('/login');
}
