import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: templates, error } = await supabaseAdmin
    .from('proposal_templates')
    .select('*, proposal_template_fields(id)')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = (templates ?? []).map((t) => ({
    ...t,
    field_count: t.proposal_template_fields?.length ?? 0,
    proposal_template_fields: undefined,
  }));

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { name, content, price, payment_type, payment_config, fields } = body;

  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const { data: template, error: templateError } = await supabaseAdmin
    .from('proposal_templates')
    .insert({
      venue_id: venueId,
      name,
      content: content ?? '',
      price: price ?? 0,
      payment_type: payment_type ?? 'full',
      payment_config: payment_config ?? {},
    })
    .select()
    .single();

  if (templateError) {
    return NextResponse.json({ error: templateError.message }, { status: 500 });
  }

  let insertedFields: unknown[] = [];

  if (fields && fields.length > 0) {
    const fieldRows = fields.map((f: Record<string, unknown>, i: number) => ({
      template_id: template.id,
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

    const { data: fieldsData, error: fieldsError } = await supabaseAdmin
      .from('proposal_template_fields')
      .insert(fieldRows)
      .select();

    if (fieldsError) {
      return NextResponse.json({ error: fieldsError.message }, { status: 500 });
    }

    insertedFields = fieldsData ?? [];
  }

  return NextResponse.json({ ...template, fields: insertedFields }, { status: 201 });
}
