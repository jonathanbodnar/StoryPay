import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const projectRef = url.match(/https?:\/\/([^.]+)\./)?.[1] || null;

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY ||
    '';

  function peek(k: string) {
    if (!k) return null;
    return { len: k.length, head: k.slice(0, 16), tail: k.slice(-8) };
  }

  return NextResponse.json({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || null,
    supabase_url: url || null,
    supabase_project_ref: projectRef,
    anon_key: peek(anonKey),
    service_role_key: peek(serviceKey),
    service_role_key_source: process.env.SUPABASE_SERVICE_ROLE_KEY
      ? 'SUPABASE_SERVICE_ROLE_KEY'
      : process.env.SUPABASE_SERVICE_KEY
      ? 'SUPABASE_SERVICE_KEY'
      : process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
      ? 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY'
      : null,
    node_env: process.env.NODE_ENV || null,
  });
}
