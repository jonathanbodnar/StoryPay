import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabaseAdmin: SupabaseClient | null = null;

function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceKey) {
      console.warn(
        '[supabase] SUPABASE_SERVICE_ROLE_KEY is not set. ' +
        'Falling back to anon key — waitlist inserts will fail if RLS is enabled.'
      );
    }

    _supabaseAdmin = createClient(url, serviceKey ?? anonKey, {
      db: { schema: 'public' },
      auth: { persistSession: false, autoRefreshToken: false },
    });
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

export const supabaseAdmin: SupabaseClient = lazyProxy(getSupabaseAdmin);
