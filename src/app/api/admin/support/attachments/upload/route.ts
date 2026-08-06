/**
 * POST /api/admin/support/attachments/upload
 *
 * Accepts a multipart FormData upload from the support inbox composer and
 * stores it in the private `support-inbox-attachments` bucket, returning a
 * signed URL the frontend can hold in composer state and later POST back to
 * the send routes as `attachments: Attachment[]`.
 *
 * Body (multipart/form-data):
 *   file:  File   (required)
 *   scope: 'thread' | 'ticket'  (required — used only for the storage path prefix)
 *   id:    string  (required — threadId or ticketId; not validated against the DB)
 *
 * Response: { ok: true, id, url, storagePath, filename, size, contentType }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySupportAccess } from '@/lib/support/auth';
import {
  ensureSupportAttachmentsBucket,
  SUPPORT_ATTACHMENTS_BUCKET,
  SUPPORT_ATTACHMENT_SIGNED_URL_TTL_SEC,
  storagePath as buildStoragePath,
  validateSupportAttachmentUpload,
} from '@/lib/support/support-attachments-bucket';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');
  const scope = String(formData.get('scope') ?? '').trim();
  const id = String(formData.get('id') ?? '').trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (scope !== 'thread' && scope !== 'ticket') {
    return NextResponse.json({ error: "scope must be 'thread' or 'ticket'" }, { status: 400 });
  }
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const contentType = file.type || 'application/octet-stream';
  const validationError = validateSupportAttachmentUpload(contentType, file.size);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const ensured = await ensureSupportAttachmentsBucket();
  if (!ensured.ok) {
    console.error('[support attachments upload] ensureBucket failed', ensured.error);
    return NextResponse.json({ error: 'Storage not available' }, { status: 500 });
  }

  const path = buildStoragePath(`${scope}/${id}`, file.name);
  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabaseAdmin.storage
    .from(SUPPORT_ATTACHMENTS_BUCKET)
    .upload(path, arrayBuffer, { contentType, upsert: false });

  if (uploadError) {
    console.error('[support attachments upload] upload failed', uploadError);
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(SUPPORT_ATTACHMENTS_BUCKET)
    .createSignedUrl(path, SUPPORT_ATTACHMENT_SIGNED_URL_TTL_SEC);

  if (signErr || !signed?.signedUrl) {
    console.error('[support attachments upload] createSignedUrl failed', signErr);
    return NextResponse.json({ error: 'Could not create download link' }, { status: 500 });
  }

  const attachmentId = crypto.randomUUID();

  return NextResponse.json({
    ok: true,
    id: attachmentId,
    url: signed.signedUrl,
    storagePath: path,
    filename: file.name,
    size: file.size,
    contentType,
  });
}
