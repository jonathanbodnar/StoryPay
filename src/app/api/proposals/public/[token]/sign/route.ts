import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { signatureData } = await request.json();

  if (!signatureData) {
    return NextResponse.json({ error: 'Signature data required' }, { status: 400 });
  }

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('id, status')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  if (proposal.status !== 'sent' && proposal.status !== 'opened') {
    return NextResponse.json({ error: 'Proposal cannot be signed in current state' }, { status: 400 });
  }

  const { error: updateError } = await supabaseAdmin
    .from('proposals')
    .update({
      status: 'signed',
      signature_data: signatureData,
      signed_at: new Date().toISOString(),
    })
    .eq('id', proposal.id);

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save signature' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
