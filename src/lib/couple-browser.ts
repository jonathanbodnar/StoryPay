'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/** Browser Supabase client for couple (bride) email/password auth. */
export function getCoupleSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return _client;
}

export async function coupleAuthedFetch(path: string, init: RequestInit = {}) {
  const supabase = getCoupleSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(path, { ...init, headers });
}
