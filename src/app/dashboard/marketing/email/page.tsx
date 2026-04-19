import { redirect } from 'next/navigation';

/** Legacy hub URL: email tools live on dedicated routes in the Marketing sidebar. */
export default function MarketingEmailHubRedirect() {
  redirect('/dashboard/marketing/email/templates');
}
