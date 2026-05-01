export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { authenticateApiV1, corsPreflight, CORS_HEADERS } from '@/lib/api-v1-auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function OPTIONS() { return corsPreflight(); }

/** GET — list this venue's marketing tags (used by Zapier dropdowns). */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin
    .from('marketing_tags')
    .select('id, name, icon, color, is_system, system_key, category, description')
    .eq('venue_id', auth.venueId)
    .order('position', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });

  return NextResponse.json(
    {
      tags: (data || []).map((t) => {
        const r = t as { id: string; name: string; icon: string | null; color: string | null; is_system: boolean | null; system_key: string | null; category: string | null; description: string | null };
        return {
          id: r.id,
          name: r.name,
          icon: r.icon || '',
          color: r.color || '',
          is_system: !!r.is_system,
          system_key: r.system_key,
          category: r.category,
          description: r.description,
        };
      }),
    },
    { headers: CORS_HEADERS },
  );
}
