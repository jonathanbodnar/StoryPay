import { createClient } from '@supabase/supabase-js';

/**
 * Before the flow tests:
 *  - the test copy goes quiet (emails nobody, not even approved addresses;
 *    everything still lands in its outbox) for the run;
 *  - follow-up sequences left running by earlier runs are finished, so this
 *    run's follow-ups never wait behind them in the job's batch of 25.
 */
export default async function setup(): Promise<void> {
  const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  if (process.env.APP_ENV !== 'staging' || !base) return; // helpers.ts refuses to run anyway
  const res = await fetch(`${base}/api/staging/outbox`, {
    method: 'POST',
    headers: { 'x-staging-key': process.env.STAGING_PASSWORD || '', 'content-type': 'application/json' },
    body: JSON.stringify({ quietMinutes: 90 }),
  });
  if (!res.ok) throw new Error(`Could not put the test copy in quiet mode: ${res.status}`);

  // Never the live database (its project ref, as in src/lib/staging.ts).
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
  if (!supabaseUrl || supabaseUrl.includes('brnxhsaakmhgwcthcapd')) throw new Error('Refusing: this is not the test copy database');
  const db = createClient(supabaseUrl, String(process.env.SUPABASE_SERVICE_ROLE_KEY), { auth: { persistSession: false } });
  const now = new Date().toISOString();
  const { error } = await db
    .from('marketing_automation_enrollments')
    .update({ status: 'completed', completed_at: now, last_error: 'finished before a test run' })
    .eq('status', 'active')
    .lt('enrolled_at', now);
  if (error) throw new Error(`Could not finish earlier runs' follow-ups: ${error.message}`);
}
