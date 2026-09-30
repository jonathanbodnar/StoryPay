/**
 * Email the couple when a guest replies to their RSVP.
 *
 * Only the couple is told; the venue sees replies in its Wedding Planner view
 * (owner's decision, Sep 30). Best-effort: a failure here never affects the
 * guest's RSVP, and re-sending the same answer doesn't email again.
 */
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function notifyCoupleOfRsvp(input: {
  coupleWeddingId: string;
  coupleId: string | null;
  guestName: string;
  attending: boolean;
  partySize: number | null;
  previousStatus: string | null;
  previousPartySize: number | null;
}): Promise<void> {
  const status = input.attending ? 'attending' : 'declined';
  const size = input.attending ? Math.max(1, input.partySize ?? 1) : 0;
  const unchanged =
    input.previousStatus === status && (!input.attending || (input.previousPartySize ?? 1) === size);
  if (unchanged) return;

  let coupleId = input.coupleId;
  if (!coupleId) {
    const { data } = await supabaseAdmin
      .from('couple_weddings')
      .select('couple_id')
      .eq('id', input.coupleWeddingId)
      .maybeSingle();
    coupleId = (data as { couple_id?: string | null } | null)?.couple_id ?? null;
  }
  if (!coupleId) return;

  const [{ data: userRes }, { data: profile }] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(coupleId),
    supabaseAdmin.from('couple_profiles').select('first_name').eq('id', coupleId).maybeSingle(),
  ]);
  const to = userRes?.user?.email?.trim();
  if (!to) return;

  const firstName = ((profile as { first_name?: string | null } | null)?.first_name || '').trim();
  const guest = input.guestName.trim() || 'A guest';
  const changed = input.previousStatus === 'attending' || input.previousStatus === 'declined';
  const subject = input.attending
    ? `${guest} ${changed ? 'updated their RSVP: coming' : 'is coming'}${size > 1 ? ` (party of ${size})` : ''}`
    : `${guest} ${changed ? 'updated their RSVP: can’t make it' : 'can’t make it'}`;
  const line = input.attending
    ? `<strong>${esc(guest)}</strong> will be there${size > 1 ? `, party of ${size}` : ''}.`
    : `<strong>${esc(guest)}</strong> can’t make it.`;

  await sendEmail({
    to,
    subject,
    html: `
<div style="font-family:'Open Sans',Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827">
  <p>${firstName ? `Hi ${esc(firstName)},` : 'Hi,'}</p>
  <p>${line}</p>
  <p><a href="${APP_URL}/couple/guests" style="color:#111827;font-weight:600;text-decoration:underline">See your guest list</a></p>
</div>`,
  });
}
