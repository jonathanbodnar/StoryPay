import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

/** Returns the stored impersonate_return URL so the banner can show a context-aware exit label. */
export async function GET() {
  const cookieStore = await cookies();
  const returnUrl = cookieStore.get('impersonate_return')?.value || null;
  return NextResponse.json({ returnUrl });
}
