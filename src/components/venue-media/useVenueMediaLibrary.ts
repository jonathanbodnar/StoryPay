'use client';

import { useCallback, useEffect, useState } from 'react';

export type VenueMediaAssetRow = {
  id: string;
  storage_path: string;
  public_url: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
};

export function useVenueMediaLibrary() {
  const [assets, setAssets] = useState<VenueMediaAssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const res = await fetch('/api/venue-media', { cache: 'no-store' });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? 'Failed to load media');
      setAssets([]);
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { assets?: VenueMediaAssetRow[] };
    setAssets(Array.isArray(data.assets) ? data.assets : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]): Promise<VenueMediaAssetRow[]> => {
      const list = Array.from(files);
      if (list.length === 0) return [];
      setUploading(true);
      setError('');
      const added: VenueMediaAssetRow[] = [];
      try {
        for (const file of list) {
          if (file.type.toLowerCase().startsWith('video/')) {
            throw new Error('Video uploads are not supported.');
          }
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
            const j = (await signedRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error ?? `Could not prepare upload for ${file.name}`);
          }
          const { signedUrl, path, publicUrl } = (await signedRes.json()) as {
            signedUrl: string;
            path: string;
            publicUrl: string;
          };
          const putRes = await fetch(signedUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file,
          });
          if (!putRes.ok) throw new Error(`Upload failed for ${file.name}`);

          const regRes = await fetch('/api/venue-media', {
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
          if (!regRes.ok) {
            const j = (await regRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error ?? `Failed to register ${file.name}`);
          }
          const reg = (await regRes.json()) as { asset?: VenueMediaAssetRow };
          if (reg.asset) added.push(reg.asset);
        }
        await load();
        return added;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
        return added;
      } finally {
        setUploading(false);
      }
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      setError('');
      const res = await fetch(`/api/venue-media/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'Delete failed');
        return false;
      }
      setAssets((prev) => prev.filter((a) => a.id !== id));
      return true;
    },
    [],
  );

  return { assets, loading, uploading, error, setError, reload: load, uploadFiles, remove };
}
