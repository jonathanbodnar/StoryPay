import type { NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Resolve Supabase Auth user from Authorization: Bearer <access_token> (couple / bride sessions).
 */
export async function getCoupleAuthUser(request: NextRequest): Promise<User | null> {
  const auth = request.headers.get('authorization');
  if (!auth?.toLowerCase().startsWith('bearer ')) return null;
  const jwt = auth.slice(7).trim();
  if (!jwt) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user;
}
