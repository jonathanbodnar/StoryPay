import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMarketingUnsubscribeToken } from '@/lib/marketing-email-tokens';
import { ManagePreferencesForm } from './ManagePreferencesForm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata = {
  title: 'Manage email preferences',
  robots: { index: false, follow: false },
};

export default async function ManagePreferencesPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawToken } = await params;
  const token = decodeURIComponent(rawToken);
  const parsed = verifyMarketingUnsubscribeToken(token);
  if (!parsed) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-16 font-sans">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-sm border border-gray-200 px-8 py-10 text-center">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Invalid link</h1>
          <p className="text-sm text-gray-500">
            This preferences link has expired or is invalid. Please check the most recent email you received and try again.
          </p>
        </div>
      </main>
    );
  }

  const [{ data: venue }, { data: lead }, { data: sup }] = await Promise.all([
    supabaseAdmin.from('venues').select('name').eq('id', parsed.venueId).maybeSingle(),
    supabaseAdmin
      .from('leads')
      .select('id, email, first_name, name, marketing_email_opt_in')
      .eq('id', parsed.leadId)
      .eq('venue_id', parsed.venueId)
      .maybeSingle(),
    supabaseAdmin
      .from('marketing_email_suppressions')
      .select('lead_id')
      .eq('venue_id', parsed.venueId)
      .eq('lead_id', parsed.leadId)
      .maybeSingle(),
  ]);

  if (!lead) return notFound();

  const venueName = (venue?.name as string) || 'this venue';
  const email = (lead.email as string) || '';
  const firstName =
    (lead.first_name as string | null)?.trim() ||
    (lead.name as string | null)?.split(/\s+/)[0] ||
    '';
  const suppressed = !!sup;
  const optInFalse = (lead as { marketing_email_opt_in?: boolean }).marketing_email_opt_in === false;
  const initiallySubscribed = !suppressed && !optInFalse;

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-16 font-sans">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-sm border border-gray-200 px-8 py-10">
        <div className="text-center mb-8">
          <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1">{venueName}</p>
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Email preferences</h1>
          <p className="text-sm text-gray-500">
            {firstName ? `Hi ${firstName} — m` : 'M'}anage how {venueName} can reach you.
          </p>
        </div>

        <ManagePreferencesForm
          token={token}
          email={email}
          venueName={venueName}
          initiallySubscribed={initiallySubscribed}
        />

        <p className="mt-8 text-center text-[11px] text-gray-400 leading-snug">
          You can update your choice at any time. We respect your preferences immediately — no account required.
        </p>
      </div>
    </main>
  );
}
