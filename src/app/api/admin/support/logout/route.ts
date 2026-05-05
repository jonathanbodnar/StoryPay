import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SUPPORT_SESSION_COOKIE } from '@/lib/support/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const c = await cookies();
  c.delete(SUPPORT_SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
