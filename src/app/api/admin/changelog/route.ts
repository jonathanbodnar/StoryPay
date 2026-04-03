import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Called by the GitHub Actions deploy webhook.
// Requires a matching CHANGELOG_WEBHOOK_SECRET header.

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-changelog-secret');
  if (!secret || secret !== process.env.CHANGELOG_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    title,
    description,
    category = 'feature',
    version,
  } = body;

  if (!title || !description) {
    return NextResponse.json({ error: 'title and description are required' }, { status: 400 });
  }

  const validCategories = ['feature', 'improvement', 'fix'];
  const safeCategory = validCategories.includes(category) ? category : 'improvement';

  const { data, error } = await supabaseAdmin
    .from('changelog_entries')
    .insert({
      title,
      description,
      category: safeCategory,
      version: version ?? null,
      released_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('[changelog-webhook] DB error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: data.id }, { status: 201 });
}
