import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export interface AdminCoupleRow {
  id: string;
  email: string | null;
  display_name: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  wedding_date: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  saved_venue_count: number;
}

/**
 * GET /api/admin/couples?search=...&limit=...
 *
 * Returns all couple accounts. Joins auth.users (email, last sign in)
 * with public.couple_profiles (display name, phone, wedding date, etc.).
 * Filters by ?search across email, display_name, and phone (case-insensitive).
 */
export async function GET(req: NextRequest) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const search = (searchParams.get('search') ?? '').trim().toLowerCase();
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '500', 10) || 500, 1000);

  // Fetch all couple_profiles
  const { data: profiles, error: profErr } = await supabaseAdmin
    .from('couple_profiles')
    .select('id, display_name, phone, city, state, wedding_date, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (profErr) {
    console.error('[admin/couples] couple_profiles fetch error:', profErr);
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ couples: [] });
  }

  // For each profile, look up the auth user (email, last sign in)
  // We page through auth.users (perPage 1000 is the API max).
  const profilesById = new Map<string, typeof profiles[number]>();
  for (const p of profiles) profilesById.set(p.id, p);

  const couples: AdminCoupleRow[] = [];
  let page = 1;
  const perPage = 1000;

  while (couples.length < profiles.length) {
    const { data: authResp, error: authErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (authErr) {
      console.error('[admin/couples] listUsers error:', authErr);
      break;
    }
    const users = authResp?.users ?? [];
    if (users.length === 0) break;

    for (const u of users) {
      const profile = profilesById.get(u.id);
      if (!profile) continue;
      couples.push({
        id: u.id,
        email: u.email ?? null,
        display_name: profile.display_name ?? null,
        phone: profile.phone ?? null,
        city: profile.city ?? null,
        state: profile.state ?? null,
        wedding_date: profile.wedding_date ?? null,
        created_at: profile.created_at ?? u.created_at ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
        email_confirmed_at: u.email_confirmed_at ?? null,
        saved_venue_count: 0,
      });
    }

    if (users.length < perPage) break;
    page += 1;
  }

  // Best-effort: counts of saved venues per couple
  try {
    const ids = couples.map((c) => c.id);
    if (ids.length > 0) {
      const { data: saves } = await supabaseAdmin
        .from('couple_saved_venues')
        .select('couple_id')
        .in('couple_id', ids);
      const counts = new Map<string, number>();
      for (const r of saves ?? []) {
        const k = (r as { couple_id: string }).couple_id;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      for (const c of couples) c.saved_venue_count = counts.get(c.id) ?? 0;
    }
  } catch {
    // saved_venues table may not exist on older schemas — ignore
  }

  // Filter by search term across email, display_name, phone
  const filtered = search
    ? couples.filter((c) => {
        const haystack = [
          c.email,
          c.display_name,
          c.phone,
          c.city,
          c.state,
        ]
          .filter((v): v is string => Boolean(v))
          .map((v) => v.toLowerCase())
          .join(' ');
        return haystack.includes(search);
      })
    : couples;

  return NextResponse.json({ couples: filtered });
}
