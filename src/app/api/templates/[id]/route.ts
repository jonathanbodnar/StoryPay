import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function getVenueId() {
  const cookieStore = await cookies();
  return cookieStore.get('venue_id')?.value;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const { data: template, error } = await supabaseAdmin
    .from('proposal_templates')
    .select('*, proposal_template_fields(*)')
    .eq('id', id)
    .eq('venue_id', venueId)
    .single();

  if (error || !template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  return NextResponse.json({
    ...template,
    fields: (template.proposal_template_fields ?? []).sort(
      (a: { sort_order: number }, b: { sort_order: number }) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0)
    ),
    proposal_template_fields: undefined,
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { name, content, price, payment_type, payment_config, fields } = body;

  const { data: existing } = await supabaseAdmin
    .from('proposal_templates')
    .select('id')
    .eq('id', id)
    .eq('venue_id', venueId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const { data: template, error: updateError } = await supabaseAdmin
    .from('proposal_templates')
    .update({
      name,
      content: content ?? '',
      price: price ?? 0,
      payment_type: payment_type ?? 'full',
      payment_config: payment_config ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await supabaseAdmin
    .from('proposal_template_fields')
    .delete()
    .eq('template_id', id);

  let insertedFields: unknown[] = [];

  if (fields && fields.length > 0) {
    const fieldRows = fields.map((f: Record<string, unknown>, i: number) => ({
      template_id: id,
      field_type: f.field_type,
      label: f.label ?? '',
      required: f.required ?? true,
      sort_order: f.sort_order ?? i,
      x_position: f.x_position ?? 0,
      y_position: f.y_position ?? 0,
      width: f.width ?? 200,
      height: f.height ?? 50,
      page_number: f.page_number ?? 1,
    }));

    const { data: fieldsData } = await supabaseAdmin
      .from('proposal_template_fields')
      .insert(fieldRows)
      .select();

    insertedFields = fieldsData ?? [];
  }

  return NextResponse.json({ ...template, fields: insertedFields });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;

  const allowed: Record<string, unknown> = {};
  if (typeof body.is_starred === 'boolean') allowed.is_starred = body.is_starred;
  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('proposal_templates')
    .update(allowed)
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('id, is_starred')
    .single();

  if (error) {
    if (/is_starred|column|does not exist/i.test(error.message ?? '')) {
      // Column doesn't exist yet — respond with the desired state so the UI can still update optimistically
      return NextResponse.json({ id, is_starred: allowed.is_starred });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const { data: existing } = await supabaseAdmin
    .from('proposal_templates')
    .select('id')
    .eq('id', id)
    .eq('venue_id', venueId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  await supabaseAdmin
    .from('proposal_template_fields')
    .delete()
    .eq('template_id', id);

  const { error } = await supabaseAdmin
    .from('proposal_templates')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
