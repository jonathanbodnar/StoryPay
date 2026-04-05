import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { secret } = await request.json();

  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set('admin_token', secret, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set('admin_token', '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return response;
}
