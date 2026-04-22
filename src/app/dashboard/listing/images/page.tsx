'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FolderOpen, Loader2, Star, Trash2, Upload, Image as ImageIcon } from 'lucide-react';
import { VenueMediaPickerModal } from '@/components/venue-media/VenueMediaPickerModal';

interface Listing {
  cover_image_url: string | null;
  gallery_images: string[];
}

const CARD = 'rounded-3xl border border-gray-200 bg-white p-6 sm:p-8';
const ACCEPT_IMAGES =
  'image/jpeg,image/jpg,image/png,image/webp,image/avif,image/gif,.jpg,.jpeg,.png,.webp,.avif,.gif';

export default function ListingImagesPage() {
  const [listing, setListing] = useState<Listing>({ cover_image_url: null, gallery_images: [] });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch('/api/listing/me', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data.listing) {
        setListing({
          cover_image_url: data.listing.cover_image_url ?? null,
          gallery_images: Array.isArray(data.listing.gallery_images) ? data.listing.gallery_images : [],
        });
      }
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save(next: Partial<Listing>) {
    const updated = { ...listing, ...next };
    setListing(updated);
    const res = await fetch('/api/listing/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Failed to save');
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError('');
    try {
      const added: string[] = [];
      for (const file of Array.from(files)) {
        // 1) Sign an upload URL into the shared venue-images bucket, using the
        //    media-library storage prefix so the asset can be registered in
        //    venue_media_assets and appear in the owner's media library.
        const signedRes = await fetch('/api/venue-media/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            size: file.size,
          }),
        });
        if (!signedRes.ok) {
          const data = await signedRes.json().catch(() => ({}));
          throw new Error(data.error ?? `Failed to prepare upload for ${file.name}`);
        }
        const { signedUrl, path, publicUrl } = (await signedRes.json()) as {
          signedUrl: string; path: string; publicUrl: string;
        };
        // 2) Upload directly to Supabase Storage.
        const putRes = await fetch(signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!putRes.ok) throw new Error(`Upload failed for ${file.name}`);
        // 3) Register in venue_media_assets so the photo is reusable from the
        //    media library (forms, emails, branding, other listings, …). If
        //    this step fails we still want the photo on the listing, so we
        //    log the error instead of aborting.
        try {
          await fetch('/api/venue-media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              path,
              publicUrl,
              fileName: file.name,
              contentType: file.type || 'application/octet-stream',
              sizeBytes: file.size,
            }),
          });
        } catch (regErr) {
          console.warn('[listing/images] media library registration failed:', regErr);
        }
        added.push(publicUrl);
      }
      const nextGallery = [...listing.gallery_images, ...added];
      const nextCover = listing.cover_image_url ?? added[0] ?? null;
      await save({ gallery_images: nextGallery, cover_image_url: nextCover });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function removeImage(url: string) {
    const nextGallery = listing.gallery_images.filter((u) => u !== url);
    const nextCover = listing.cover_image_url === url ? (nextGallery[0] ?? null) : listing.cover_image_url;
    save({ gallery_images: nextGallery, cover_image_url: nextCover });
  }

  function setCover(url: string) {
    save({ cover_image_url: url });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/dashboard/listing" className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to listing
          </Link>
          <h1 className="font-heading text-2xl text-gray-900 mt-1">Photos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            The first photo (or the one you star) is the cover image couples see first.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT_IMAGES}
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
          >
            <FolderOpen className="w-4 h-4" />
            From media library
          </button>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: '#1b1b1b' }}
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading…' : 'Upload photos'}
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className={CARD}>
        {listing.gallery_images.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center text-gray-400">
            <ImageIcon className="w-10 h-10 mb-3" />
            <p className="text-sm">No photos yet. Upload your first photo to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {listing.gallery_images.map((url) => {
              const isCover = listing.cover_image_url === url;
              return (
                <div key={url} className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-40 w-full object-cover" />
                  <div className="absolute inset-0 flex items-end justify-between p-2 opacity-0 transition-opacity group-hover:opacity-100"
                       style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55), transparent 60%)' }}>
                    <button
                      onClick={() => setCover(url)}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                        isCover ? 'bg-yellow-400 text-gray-900' : 'bg-white/90 text-gray-900 hover:bg-white'
                      }`}
                    >
                      <Star className="w-3 h-3" /> {isCover ? 'Cover' : 'Set cover'}
                    </button>
                    <button
                      onClick={() => removeImage(url)}
                      className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-white"
                    >
                      <Trash2 className="w-3 h-3" /> Remove
                    </button>
                  </div>
                  {isCover && (
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-yellow-400 px-2 py-0.5 text-[10px] font-semibold text-gray-900">
                      <Star className="w-3 h-3" /> Cover
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <VenueMediaPickerModal
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        onSelect={async (url) => {
          const nextGallery = listing.gallery_images.includes(url)
            ? listing.gallery_images
            : [...listing.gallery_images, url];
          const nextCover = listing.cover_image_url ?? url;
          await save({ gallery_images: nextGallery, cover_image_url: nextCover });
        }}
      />
    </div>
  );
}
