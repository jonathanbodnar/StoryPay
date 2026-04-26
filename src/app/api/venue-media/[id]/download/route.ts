import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { VENUE_IMAGES_BUCKET } from '@/lib/venue-images-bucket';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * Streams a media asset back through the Next.js origin with
 * `Content-Disposition: attachment` so the browser actually saves it to the
 * user's computer instead of just navigating to the (cross-origin) public URL
 * in a new tab. The HTML `<a download>` attribute is ignored across origins,
 * so we proxy through the app domain to apply our own headers.
 *
 * Pass `?inline=1` to return the file with `Content-Disposition: inline`,
 * which lets us embed PDFs / text / spreadsheets in the in-app preview modal
 * without triggering the download.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { data: row, error } = await supabaseAdmin
    .from('venue_media_assets')
    .select('storage_path, source_bucket, file_name, display_name, content_type')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (error) {
    console.error('[venue-media download] fetch row', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const bucket = (row.source_bucket as string | null) ?? VENUE_IMAGES_BUCKET;
  const { data: blob, error: dlErr } = await supabaseAdmin.storage
    .from(bucket)
    .download(row.storage_path);
  if (dlErr || !blob) {
    console.error('[venue-media download] storage', dlErr?.message);
    return NextResponse.json({ error: dlErr?.message ?? 'File unavailable' }, { status: 404 });
  }

  const url = new URL(request.url);
  const inline = url.searchParams.get('inline') === '1';

  // Build a clean download filename.
  // Prefer display_name (user-visible label) but always preserve the extension
  // from the original file_name so the OS can recognise the file type.
  // e.g. display_name="Brand logo", file_name="logo-abc.png" → "Brand logo.png"
  const extMatch = (row.file_name as string | null)?.match(/(\.[^.]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  const baseName = (row.display_name?.trim() || row.file_name || 'file').replace(
    /[\r\n"\\]/g,
    '',
  );
  // Append the extension only when the chosen base name doesn't already end with it.
  const safeName = baseName.toLowerCase().endsWith(ext) ? baseName : `${baseName}${ext}`;
  const disposition = `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`;

  return new NextResponse(blob, {
    headers: {
      'Content-Type': (row.content_type as string) || 'application/octet-stream',
      'Content-Disposition': disposition,
      'Content-Length': String(blob.size),
      // Tenant-scoped, short-lived cache. Avoid serving stale renames across
      // tabs and keep things snappy when previewing the same file repeatedly.
      'Cache-Control': 'private, max-age=60',
    },
  });
}
