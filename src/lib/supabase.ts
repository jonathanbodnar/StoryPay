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
    // Try multiple common env var names for the service role key
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

          if (!serviceKey) {
            if (process.env.NODE_ENV === 'production') {
              // Falling back to the anon key in prod would silently strip the
              // service-role RLS bypass, denying access to every server-only
              // table. Fail loudly instead of limping in an insecure state.
              throw new Error(
                '[supabase] SUPABASE_SERVICE_ROLE_KEY is not set in production. ' +
                'Refusing to fall back to the anon key. Set SUPABASE_SERVICE_ROLE_KEY in Railway.'
              );
            }
            console.error(
              '[supabase] SUPABASE_SERVICE_ROLE_KEY is not set. ' +
              'Falling back to anon key for local dev — server-only tables will be denied by RLS. ' +
              'Add SUPABASE_SERVICE_ROLE_KEY to your environment for full access.'
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

export const supabase: SupabaseClient = lazyProxy(getSupabase);
export const supabaseAdmin: SupabaseClient = lazyProxy(getSupabaseAdmin);
