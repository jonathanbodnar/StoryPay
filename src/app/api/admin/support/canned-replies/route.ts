/**
 * GET  /api/admin/support/canned-replies          list (super admin OR support agent)
 * POST /api/admin/support/canned-replies          create (super admin OR support_admin role)
 *
 * Query: ?scope=admin|venue|both  (filters list)
 *        ?channel=sms|email       (filters list to channel-eligible templates)
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await verifySupportAccess();
  if (!auth.isSuperAdmin && !auth.agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const scope   = (searchParams.get('scope') || '').trim();
  const channel = (searchParams.get('channel') || '').trim();

  let query = supabaseAdmin
    .from('support_canned_replies')
    .select('id, title, body, scope, shortcut, category, channels, use_count, updated_at, created_at')
    .order('use_count', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(500);

  if (scope === 'admin')   query = query.in('scope', ['admin', 'both']);
  if (scope === 'venue')   query = query.in('scope', ['venue', 'both']);
  if (scope === 'both')    query = query.eq('scope', 'both');
  if (channel === 'sms' || channel === 'email') {
    query = query.contains('channels', [channel]);
  }

  const { data, error } = await query;
  if (error) {
    // Gracefully handle the case where migration 109 hasn't been applied yet —
    // return an empty list so the saved-replies page shows the "create your
    // first template" empty state rather than a scary error banner.
    const msg = error.message ?? '';
    const code = (error as { code?: string }).code;
    if (
      code === '42P01' ||
      /support_canned_replies/i.test(msg) ||
      /schema cache/i.test(msg) ||
      /relation .* does not exist/i.test(msg)
    ) {
      return NextResponse.json({
        templates: [],
        warning: 'Saved-replies table not initialized yet. Run migration 109 in your Supabase SQL editor.',
      });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await verifySupportAccess();
  // Only super admin OR support_admin role can author templates
  const canAuthor = auth.isSuperAdmin || auth.agent?.role === 'support_admin';
  if (!canAuthor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: {
    title?: string;
    body?: string;
    scope?: 'admin' | 'venue' | 'both';
    shortcut?: string;
    category?: string;
    channels?: ('sms' | 'email')[];
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const title = (body.title || '').trim();
  const text  = (body.body || '').trim();
  if (!title || !text) {
    return NextResponse.json({ error: 'title and body are required' }, { status: 400 });
  }

  const scope = body.scope === 'admin' || body.scope === 'venue' ? body.scope : 'both';
  const channels = Array.isArray(body.channels) && body.channels.length > 0
    ? body.channels.filter(c => c === 'sms' || c === 'email')
    : ['sms', 'email'];

  const insert: Record<string, unknown> = {
    title,
    body: text,
    scope,
    channels,
    shortcut: body.shortcut?.trim() || null,
    category: body.category?.trim() || null,
    created_by_support_user_id: auth.agent?.sub ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from('support_canned_replies')
    .insert(insert)
    .select('id, title, body, scope, shortcut, category, channels, use_count, updated_at, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data }, { status: 201 });
}
