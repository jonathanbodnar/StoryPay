/**
 * Server-side Meta (Facebook) Conversions API integration, per venue.
 *
 * When a bride submits the lead-capture form on a venue's public directory
 * listing page, we fire a `Lead` event to Meta's Conversions API on that
 * venue's behalf so they can optimize ad campaigns using real guide-download
 * conversions — with no client-side pixel script, domain verification, or
 * JavaScript on our pages.
 *
 * Configured per venue via the `meta_pixel_id` + `meta_capi_access_token`
 * columns on `venues` (plain columns, same pattern as `ghl_access_token` —
 * no app-level encryption layer). No-ops if either is missing for a venue.
 *
 * Best-effort — never throws. Errors are logged with `console.warn` so this
 * can never block or fail lead creation, even if Meta's API is down,
 * misconfigured, or rejects the request.
 */

import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';

const META_API_VERSION = 'v19.0';

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Lowercase + trim, per Meta's Advanced Matching normalization rules. */
function hashText(value: string): string {
  return sha256(value.trim().toLowerCase());
}

/** Digits only (no leading `+`), per Meta's phone normalization rules. */
function hashPhone(value: string): string {
  return sha256(value.replace(/\D/g, ''));
}

export interface SendMetaLeadEventOpts {
  venueId: string;
  email: string;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  eventSourceUrl: string;
}

export async function sendMetaLeadEvent(opts: SendMetaLeadEventOpts): Promise<void> {
  try {
    const { data: venue, error } = await supabaseAdmin
      .from('venues')
      .select('meta_pixel_id, meta_capi_access_token')
      .eq('id', opts.venueId)
      .maybeSingle();

    if (error) {
      console.warn('[meta-conversions-api] venue lookup failed for venue', opts.venueId, error.message);
      return;
    }

    const pixelId = (venue as { meta_pixel_id?: string | null } | null)?.meta_pixel_id?.trim();
    const accessToken = (venue as { meta_capi_access_token?: string | null } | null)?.meta_capi_access_token?.trim();

    // Venue hasn't configured Meta tracking — silent no-op.
    if (!pixelId || !accessToken) return;

    const email = (opts.email || '').trim();
    if (!email) return;

    const userData: Record<string, string[]> = {
      em: [hashText(email)],
    };
    if (opts.phone && opts.phone.trim()) userData.ph = [hashPhone(opts.phone)];
    if (opts.firstName && opts.firstName.trim()) userData.fn = [hashText(opts.firstName)];
    if (opts.lastName && opts.lastName.trim()) userData.ln = [hashText(opts.lastName)];

    const payload = {
      data: [
        {
          event_name: 'Lead',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: opts.eventSourceUrl,
          user_data: userData,
        },
      ],
      access_token: accessToken,
    };

    const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[meta-conversions-api] non-OK response for venue', opts.venueId, res.status, body);
    }
  } catch (err) {
    console.warn('[meta-conversions-api] failed to send Lead event for venue', opts.venueId, err);
  }
}
