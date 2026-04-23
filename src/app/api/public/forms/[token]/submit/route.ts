import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import {
  INPUT_BLOCK_TYPES,
  formFieldName,
  parseDefinition,
  resolvePostSubmit,
} from '@/lib/marketing-form-schema';

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

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

  const utm: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const) {
    const v = fd.get(k);
    if (typeof v === 'string' && v.trim()) utm[k] = v.trim();
  }
  if (Object.keys(utm).length > 0) {
    (payload as Record<string, unknown>)._utm = utm;
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

  // ── Extract contact fields from the submission payload ────────────────────
  let firstNameVal = '';
  let lastNameVal = '';
  let emailVal = '';
  let phoneVal = '';

  for (const block of definition.blocks) {
    const val = payload[block.id];
    if (typeof val !== 'string') continue;
    if (block.type === 'first_name') firstNameVal = val.trim();
    else if (block.type === 'last_name') lastNameVal = val.trim();
    else if (block.type === 'email') emailVal = val.trim().toLowerCase();
    else if (block.type === 'phone') phoneVal = val.trim();
  }

  const contactName = [firstNameVal, lastNameVal].filter(Boolean).join(' ') || emailVal;
  const settings = definition.settings;

  // ── Always upsert to venue_customers (contacts) if we have an email ───────
  let customerId: string | null = null;
  if (emailVal && isEmail(emailVal)) {
    try {
      const { data: vc } = await supabaseAdmin
        .from('venue_customers')
        .upsert(
          {
            venue_id:       formRow.venue_id,
            customer_email: emailVal,
            first_name:     firstNameVal || null,
            last_name:      lastNameVal || null,
            phone:          phoneVal || null,
            updated_at:     new Date().toISOString(),
          },
          { onConflict: 'venue_id,customer_email' },
        )
        .select('id')
        .maybeSingle();
      if (vc) customerId = vc.id as string;
    } catch (e) {
      console.warn('[form submit] venue_customers upsert failed:', e);
    }

    // ── Route submission into a pipeline stage (create lead) ─────────────
    if (settings?.pipelineStageId) {
      try {
        const { data: stageRow } = await supabaseAdmin
          .from('lead_pipeline_stages')
          .select('id, name, pipeline_id')
          .eq('id', settings.pipelineStageId)
          .eq('venue_id', formRow.venue_id)
          .maybeSingle();

        if (stageRow) {
          const { error: leadErr } = await supabaseAdmin.from('leads').insert({
            venue_id:    formRow.venue_id,
            name:        contactName,
            first_name:  firstNameVal || null,
            last_name:   lastNameVal || null,
            email:       emailVal,
            phone:       phoneVal || null,
            source:      'form',
            status:      'lead',
            pipeline_id: stageRow.pipeline_id,
            stage_id:    stageRow.id,
            position:    0,
          });
          if (leadErr) {
            console.warn('[form submit] lead insert failed:', leadErr.message);
          }
        }
      } catch (e) {
        console.warn('[form submit] lead routing failed:', e);
      }
    }
  }

  // ── Notification emails ───────────────────────────────────────────────────
  if (settings?.notificationEmails) {
    const recipients = settings.notificationEmails
      .split(',')
      .map((s) => s.trim())
      .filter((s) => isEmail(s));

    if (recipients.length > 0) {
      try {
        const { data: venueRow } = await supabaseAdmin
          .from('venues')
          .select('name')
          .eq('id', formRow.venue_id)
          .maybeSingle();
        const venueName = venueRow?.name ?? 'your venue';

        const { data: formMeta } = await supabaseAdmin
          .from('marketing_forms')
          .select('name')
          .eq('id', formRow.id)
          .maybeSingle();
        const formName = formMeta?.name ?? 'Form submission';

        const fieldRows = definition.blocks
          .filter((b) => INPUT_BLOCK_TYPES.includes(b.type) && payload[b.id] !== undefined)
          .map((b) => {
            const val = Array.isArray(payload[b.id])
              ? (payload[b.id] as string[]).join(', ')
              : typeof payload[b.id] === 'object'
                ? '[file attachment]'
                : String(payload[b.id] ?? '');
            return `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;">${escapeHtml(b.label || b.type)}</td><td style="padding:4px 0;">${escapeHtml(val)}</td></tr>`;
          })
          .join('');

        const html = `
          <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1b1b1b;">
            <h2 style="margin:0 0 8px;">New form submission</h2>
            <p style="margin:0 0 16px;color:#555;">${escapeHtml(formName)} · ${escapeHtml(venueName)}</p>
            <table style="width:100%;border-collapse:collapse;">${fieldRows}</table>
          </div>`;

        for (const to of recipients) {
          await sendEmail({
            to,
            subject: `New submission: ${formName} — ${venueName}`,
            html,
            ...(emailVal ? { replyTo: emailVal } : {}),
          }).catch((e) => console.warn('[form submit] notification email error:', e));
        }
      } catch (e) {
        console.warn('[form submit] notification email setup failed:', e);
      }
    }
  }

  void customerId; // suppress unused-variable warning

  const ps = resolvePostSubmit(definition);
  return NextResponse.json({
    ok: true,
    postSubmit: {
      mode: ps.mode,
      redirectUrl: ps.mode === 'redirect' ? ps.redirectUrl || null : null,
      messageHtml: ps.mode !== 'redirect' ? ps.messageHtml : null,
    },
  });
}
