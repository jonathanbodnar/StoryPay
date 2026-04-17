import { NextRequest, NextResponse } from 'next/server';
import { runMarketingEmailCron } from '@/lib/marketing-email-worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function cronSecret(): string {
  return process.env.MARKETING_CRON_SECRET || process.env.CRON_SECRET || '';
}

function authorize(request: NextRequest): boolean {
  const secret = cronSecret();
  if (!secret) return process.env.NODE_ENV !== 'production';
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token === secret) return true;
  const q = request.nextUrl.searchParams.get('secret');
  return !!q && q === secret;
}

/** Scheduled HTTP job (e.g. Railway Cron, GitHub Actions, curl): campaigns + automation steps. */
export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runMarketingEmailCron();
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error('[cron marketing-email]', e);
    return NextResponse.json({ error: 'Processor failed' }, { status: 500 });
  }
}
