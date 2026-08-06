import { supabaseAdmin } from '@/lib/supabase';

/** Private bucket — every download goes through a signed URL. */
export const SUPPORT_ATTACHMENTS_BUCKET = 'support-inbox-attachments';

/** Matches the 7-day TTL convention used by the customer-files sms-attachment route. */
export const SUPPORT_ATTACHMENT_SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 7;

/** Reasonable cap for email/SMS attachments (MMS + most inbox providers cap well below this). */
export const SUPPORT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export const SUPPORT_ATTACHMENT_ALLOWED_MIME = [
  // Images
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
] as const;

export function isAllowedSupportAttachmentMime(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return SUPPORT_ATTACHMENT_ALLOWED_MIME.includes(ct as (typeof SUPPORT_ATTACHMENT_ALLOWED_MIME)[number]);
}

/** Validates size/MIME. Returns an error string, or null when valid. */
export function validateSupportAttachmentUpload(contentType: string, size: number): string | null {
  if (!isAllowedSupportAttachmentMime(contentType)) {
    return `Unsupported file type: ${contentType}`;
  }
  if (size > SUPPORT_ATTACHMENT_MAX_BYTES) {
    return `File exceeds ${Math.round(SUPPORT_ATTACHMENT_MAX_BYTES / (1024 * 1024))}MB limit`;
  }
  return null;
}

/** Namespaces the storage object under the owning thread/ticket id. */
export function storagePath(threadOrTicketId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  return `${threadOrTicketId}/${id}-${safe}`;
}

let bucketEnsured = false;

/** Idempotent — creates the private bucket if it doesn't already exist. */
export async function ensureSupportAttachmentsBucket(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (bucketEnsured) return { ok: true };

  const { data } = await supabaseAdmin.storage.getBucket(SUPPORT_ATTACHMENTS_BUCKET);
  if (data) {
    bucketEnsured = true;
    return { ok: true };
  }

  const { error: createErr } = await supabaseAdmin.storage.createBucket(SUPPORT_ATTACHMENTS_BUCKET, {
    public: false,
    fileSizeLimit: SUPPORT_ATTACHMENT_MAX_BYTES,
    allowedMimeTypes: [...SUPPORT_ATTACHMENT_ALLOWED_MIME],
  });
  if (createErr && !/already exists/i.test(createErr.message)) {
    return { ok: false, error: `createBucket: ${createErr.message}` };
  }

  bucketEnsured = true;
  return { ok: true };
}

/** Canonical Attachment shape shared with the frontend composer. */
export interface SupportAttachment {
  id:          string;
  url:         string;
  storagePath: string;
  filename:    string;
  size:        number;
  contentType: string;
}

interface ResendReceivingAttachment {
  id:                string;
  filename:          string;
  size:              number;
  content_type:      string;
  content_disposition?: string;
  download_url:      string;
}

/**
 * Fetches attachment metadata for an inbound Resend email (webhooks only
 * carry metadata, not content — see
 * https://resend.com/docs/dashboard/receiving/attachments), downloads each
 * one from its short-lived `download_url`, and re-uploads it into our own
 * private bucket so it renders the same way outbound attachments do.
 *
 * Best-effort: a single attachment failing to download/upload is logged and
 * skipped rather than failing the whole inbound ingest.
 */
export async function fetchAndStoreInboundEmailAttachments(
  resendEmailId: string,
  scopeId: string,
): Promise<SupportAttachment[]> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return [];

  try {
    const listRes = await fetch(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(resendEmailId)}/attachments`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!listRes.ok) {
      console.warn('[inbound attachments] list failed', resendEmailId, listRes.status);
      return [];
    }
    const listJson = (await listRes.json()) as { data?: ResendReceivingAttachment[] };
    const attachments = (listJson.data ?? []).slice(0, 10);
    if (attachments.length === 0) return [];

    const ensured = await ensureSupportAttachmentsBucket();
    if (!ensured.ok) {
      console.warn('[inbound attachments] bucket not available', ensured.error);
      return [];
    }

    const results: SupportAttachment[] = [];
    for (const att of attachments) {
      // Inline images referenced by content_id (e.g. logo images embedded in
      // the HTML body) aren't useful as a standalone chip/thumbnail — skip.
      if (att.content_disposition === 'inline' && !att.content_type?.startsWith('image/')) continue;
      const contentType = att.content_type || 'application/octet-stream';
      const err = validateSupportAttachmentUpload(contentType, att.size || 0);
      if (err) {
        console.warn('[inbound attachments] skipped', att.filename, err);
        continue;
      }
      try {
        const fileRes = await fetch(att.download_url);
        if (!fileRes.ok) continue;
        const buf = Buffer.from(await fileRes.arrayBuffer());
        const path = storagePath(`inbound/${scopeId}`, att.filename || 'attachment');
        const { error: upErr } = await supabaseAdmin.storage
          .from(SUPPORT_ATTACHMENTS_BUCKET)
          .upload(path, buf, { contentType, upsert: false });
        if (upErr) { console.warn('[inbound attachments] upload failed', att.filename, upErr.message); continue; }
        const { data: signed } = await supabaseAdmin.storage
          .from(SUPPORT_ATTACHMENTS_BUCKET)
          .createSignedUrl(path, SUPPORT_ATTACHMENT_SIGNED_URL_TTL_SEC);
        if (!signed?.signedUrl) continue;
        results.push({
          id: crypto.randomUUID(),
          url: signed.signedUrl,
          storagePath: path,
          filename: att.filename || 'attachment',
          size: att.size || buf.length,
          contentType,
        });
      } catch (e) {
        console.warn('[inbound attachments] failed for', att.filename, e);
      }
    }
    return results;
  } catch (e) {
    console.warn('[inbound attachments] fetch failed', resendEmailId, e);
    return [];
  }
}
