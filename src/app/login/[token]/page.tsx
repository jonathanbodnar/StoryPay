import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';

export default async function LoginPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  try {
    const { data: venueToken, error: tokenError } = await supabaseAdmin
      .from('venue_tokens')
      .select('venue_id')
      .eq('token', token)
      .single();

    if (tokenError || !venueToken) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="font-heading text-2xl text-navy-900 mb-3">Invalid or Expired Link</h1>
            <p className="text-gray-500">
              This login link is no longer valid. Please contact support to receive a new one.
            </p>
          </div>
        </div>
      );
    }

    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('setup_completed')
      .eq('id', venueToken.venue_id)
      .single();

    const cookieStore = await cookies();
    cookieStore.set('venue_id', venueToken.venue_id, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });

    redirect(venue?.setup_completed ? '/dashboard' : '/setup');
  } catch (err) {
    if (err && typeof err === 'object' && 'digest' in err) throw err;

    const msg = err instanceof Error ? err.message : String(err);
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="font-heading text-2xl text-navy-900 mb-3">Something Went Wrong</h1>
          <p className="text-gray-500 text-sm">{msg}</p>
        </div>
      </div>
    );
  }
}
