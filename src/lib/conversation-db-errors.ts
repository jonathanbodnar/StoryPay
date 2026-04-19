/** Map Supabase/Postgres errors from conversation routes into HTTP responses. */

export function conversationHttpError(
  err: { message: string; code?: string } | null | undefined,
): {
  status: number;
  body: { error: string };
} {
  const message = err?.message ?? 'Database error';
  const lower = message.toLowerCase();
  const code = err?.code;

  if (
    code === '42P01' ||
    code === '42883' ||
    (lower.includes('relation') && lower.includes('does not exist')) ||
    lower.includes('42p01') ||
    (lower.includes('could not find') && lower.includes('schema cache'))
  ) {
    return {
      status: 503,
      body: {
        error:
          'Conversations are not available yet. Apply migration 022_conversations.sql to your Supabase database (SQL Editor or migrations), then reload the schema cache.',
      },
    };
  }

  if (
    lower.includes('permission denied') ||
    lower.includes('42501') ||
    lower.includes('must be owner of') ||
    lower.includes('pgrst') && lower.includes('permission')
  ) {
    return {
      status: 503,
      body: {
        error:
          'Server cannot access conversation data. Set SUPABASE_SERVICE_ROLE_KEY on your hosting environment (never expose it in client code).',
      },
    };
  }

  if (lower.includes('function') && lower.includes('does not exist')) {
    return {
      status: 503,
      body: {
        error:
          'Conversations helper is missing. Apply migration 022_conversations.sql so function conversation_threads_with_meta exists, or rely on the API fallback after tables exist.',
      },
    };
  }

  return {
    status: 500,
    body: { error: message },
  };
}
