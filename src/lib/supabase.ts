import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;
let _supabaseAdmin: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _supabase;
}

function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey;
    _supabaseAdmin = createClient(url, serviceKey);
  }
  return _supabaseAdmin;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyProxy(getter: () => SupabaseClient): any {
  return new Proxy({}, {
    get(_, prop: string) {
      const client = getter();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const val = (client as any)[prop];
      if (typeof val === 'function') return val.bind(client);
      return val;
    },
  });
}

export const supabase: SupabaseClient = lazyProxy(getSupabase);
export const supabaseAdmin: SupabaseClient = lazyProxy(getSupabaseAdmin);
