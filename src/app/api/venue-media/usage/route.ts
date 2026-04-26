import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

type UsageRef = {
  kind: 'logo' | 'listing_cover' | 'listing_gallery' | 'email_campaign' | 'email_template' | 'form';
  label: string;
  /** Internal dashboard href to jump to the owning resource (best effort). */
  href: string;
};

/**
 * Recursively collect every string value from an arbitrary JSON tree. Used
 * to scan email/form definition JSON for media URLs without having to know
 * every block schema field by name.
 */
function collectStrings(node: unknown, out: Set<string>): void {
  if (node == null) return;
  if (typeof node === 'string') {
    if (node.startsWith('http://') || node.startsWith('https://')) out.add(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out);
    return;
  }
  if (typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) collectStrings(v, out);
  }
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const usage: Record<string, UsageRef[]> = {};
  const push = (url: string, ref: UsageRef) => {
    if (!url) return;
    const list = usage[url] ?? (usage[url] = []);
    // Cap per-asset references so we don't blow up payloads on heavily
    // reused URLs (the UI only needs to show that *something* uses it plus a
    // few deep-links).
    if (list.length < 8) list.push(ref);
  };

  const [venueRes, campaignsRes, templatesRes, formsRes] = await Promise.all([
    supabaseAdmin
      .from('venues')
      .select('brand_logo_url, cover_image_url, gallery_images')
      .eq('id', venueId)
      .maybeSingle(),
    supabaseAdmin
      .from('marketing_campaigns')
      .select('id, name, template_id')
      .eq('venue_id', venueId),
    supabaseAdmin
      .from('marketing_email_templates')
      .select('id, name, definition_json')
      .eq('venue_id', venueId),
    supabaseAdmin
      .from('marketing_forms')
      .select('id, name, definition_json')
      .eq('venue_id', venueId),
  ]);

  const venue = venueRes.data as
    | { brand_logo_url?: string | null; cover_image_url?: string | null; gallery_images?: string[] | null }
    | null;

  if (venue?.brand_logo_url) {
    push(venue.brand_logo_url, {
      kind: 'logo',
      label: 'Brand logo',
      href: '/dashboard/settings/branding',
    });
  }
  if (venue?.cover_image_url) {
    push(venue.cover_image_url, {
      kind: 'listing_cover',
      label: 'Listing cover photo',
      href: '/dashboard/listing/images',
    });
  }
  if (Array.isArray(venue?.gallery_images)) {
    for (const url of venue.gallery_images as string[]) {
      if (typeof url === 'string' && url) {
        push(url, {
          kind: 'listing_gallery',
          label: 'Listing gallery',
          href: '/dashboard/listing/images',
        });
      }
    }
  }

  // Templates carry the email design JSON; campaigns just point at a template.
  const templateUrls = new Map<string, Set<string>>(); // templateId → urls
  for (const tpl of (templatesRes.data ?? []) as Array<{ id: string; name: string; definition_json: unknown }>) {
    const set = new Set<string>();
    collectStrings(tpl.definition_json, set);
    templateUrls.set(tpl.id, set);
    for (const url of set) {
      push(url, {
        kind: 'email_template',
        label: `Email template: ${tpl.name}`,
        href: `/dashboard/marketing/email/templates/${tpl.id}`,
      });
    }
  }
  for (const c of (campaignsRes.data ?? []) as Array<{ id: string; name: string; template_id: string }>) {
    const urls = templateUrls.get(c.template_id);
    if (!urls) continue;
    for (const url of urls) {
      push(url, {
        kind: 'email_campaign',
        label: `Email campaign: ${c.name}`,
        href: `/dashboard/marketing/email/campaigns/${c.id}/design`,
      });
    }
  }

  for (const f of (formsRes.data ?? []) as Array<{ id: string; name: string; definition_json: unknown }>) {
    const set = new Set<string>();
    collectStrings(f.definition_json, set);
    for (const url of set) {
      push(url, {
        kind: 'form',
        label: `Form: ${f.name}`,
        href: `/dashboard/marketing/form-builder/${f.id}`,
      });
    }
  }

  return NextResponse.json({ usage });
}
