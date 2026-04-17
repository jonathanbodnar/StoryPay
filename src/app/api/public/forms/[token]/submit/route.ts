import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { INPUT_BLOCK_TYPES, formFieldName, parseDefinition } from '@/lib/marketing-form-schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'marketing-form-uploads';
const MAX_FILE_BYTES = 8 * 1024 * 1024;

async function ensureBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(BUCKET);
  if (data) return;
  await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
}

const NAME_RE =
  /^bf_([\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12})$/i;

function safeFileSegment(name: string): string {
  const base = name.replace(/^.*[/\\]/, '').replace(/[^\w.\-()+ ]/g, '_').slice(0, 120);
  return base || 'file';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/.test(token)) {
    return NextResponse.json({ error: 'Invalid form' }, { status: 404 });
  }

  const { data: formRow, error: loadErr } = await supabaseAdmin
    .from('marketing_forms')
    .select('id, venue_id, published, definition_json')
    .eq('embed_token', token)
    .maybeSingle();

  if (loadErr || !formRow) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 });
  }
  if (!formRow.published) {
    return NextResponse.json({ error: 'Form is not published' }, { status: 403 });
  }

  const definition = parseDefinition(formRow.definition_json);
  const byId = new Map(definition.blocks.map((b) => [b.id, b]));

  let fd: FormData;
  try {
    fd = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const payload: Record<string, unknown> = {};

  for (const block of definition.blocks) {
    if (!INPUT_BLOCK_TYPES.includes(block.type)) continue;
    const name = formFieldName(block);
    if (block.type === 'file') {
      const file = fd.get(name);
      if (!file || typeof file === 'string' || (file instanceof File && file.size === 0)) {
        if (block.required) {
          return NextResponse.json({ error: `Field required: ${block.label || 'file'}` }, { status: 400 });
        }
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'File too large (max 8 MB)' }, { status: 400 });
      }
      await ensureBucket();
      const sub = `${formRow.venue_id}/${formRow.id}/${randomUUID()}/${safeFileSegment(file.name)}`;
      const buf = Buffer.from(await file.arrayBuffer());
      const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(sub, buf, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
      if (upErr) {
        console.error('[form submit upload]', upErr);
        return NextResponse.json({ error: 'Could not store file' }, { status: 500 });
      }
      payload[block.id] = {
        kind: 'file',
        path: sub,
        name: file.name,
        size: file.size,
        mime: file.type || null,
      };
      continue;
    }

    if (block.type === 'checkbox_group') {
      const vals = fd.getAll(name).filter((v) => typeof v === 'string' && v.length > 0) as string[];
      if (block.required && vals.length === 0) {
        return NextResponse.json({ error: `Field required: ${block.label || 'checkboxes'}` }, { status: 400 });
      }
      payload[block.id] = vals;
      continue;
    }

    const raw = fd.get(name);
    const str = typeof raw === 'string' ? raw.trim() : '';
    if (block.required && !str) {
      return NextResponse.json({ error: `Field required: ${block.label || block.type}` }, { status: 400 });
    }
    if (str) payload[block.id] = str;
  }

  for (const key of new Set(fd.keys())) {
    const m = key.match(NAME_RE);
    if (!m) continue;
    const bid = m[1];
    const bl = byId.get(bid);
    if (!bl || !INPUT_BLOCK_TYPES.includes(bl.type)) {
      return NextResponse.json({ error: 'Unexpected field' }, { status: 400 });
    }
  }

  const { error: insErr } = await supabaseAdmin.from('marketing_form_submissions').insert({
    form_id: formRow.id,
    venue_id: formRow.venue_id,
    payload,
  });

  if (insErr) {
    console.error('[form submit insert]', insErr);
    return NextResponse.json({ error: 'Could not save submission' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
