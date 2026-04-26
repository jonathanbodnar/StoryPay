'use client';

import { useCallback, useEffect, useState } from 'react';

export type VenueMediaAssetRow = {
  id: string;
  storage_path: string;
  public_url: string;
  file_name: string;
  display_name: string | null;
  content_type: string;
  size_bytes: number;
  created_at: string;
};

export type VenueMediaUploadProgress = {
  /** Stable per-upload id used by the page UI. */
  id: string;
  fileName: string;
  size: number;
  /** 0-100 (or null while we don't have signal). Server registration counts as 100. */
  progress: number | null;
  status: 'queued' | 'uploading' | 'registering' | 'done' | 'error';
  error?: string;
};

const PROGRESS_TICK_RESET_MS = 2500;

function uploadToSignedUrl(
  signedUrl: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      void fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file })
        .then((r) => (r.ok ? resolve() : reject(new Error(`Upload failed: ${r.status}`))))
        .catch(reject);
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(file);
  });
}

export function useVenueMediaLibrary() {
  const [assets, setAssets] = useState<VenueMediaAssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [uploads, setUploads] = useState<VenueMediaUploadProgress[]>([]);

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

  const updateUpload = useCallback((id: string, patch: Partial<VenueMediaUploadProgress>) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }, []);

  const sweepFinishedUploads = useCallback(() => {
    setUploads((prev) => prev.filter((u) => u.status !== 'done'));
  }, []);

  const uploadFiles = useCallback(
    async (files: FileList | File[]): Promise<VenueMediaAssetRow[]> => {
      const list = Array.from(files);
      if (list.length === 0) return [];
      setUploading(true);
      setError('');
      const queued: VenueMediaUploadProgress[] = list.map((f) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${f.name}`,
        fileName: f.name,
        size: f.size,
        progress: 0,
        status: 'queued',
      }));
      setUploads((prev) => [...prev, ...queued]);

      const added: VenueMediaAssetRow[] = [];
      try {
        for (let i = 0; i < list.length; i++) {
          const file = list[i];
          const u = queued[i];
          if (file.type.toLowerCase().startsWith('video/')) {
            updateUpload(u.id, { status: 'error', error: 'Video uploads are not supported.' });
            throw new Error('Video uploads are not supported.');
          }
          updateUpload(u.id, { status: 'uploading', progress: 0 });

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
            const msg = j.error ?? `Could not prepare upload for ${file.name}`;
            updateUpload(u.id, { status: 'error', error: msg });
            throw new Error(msg);
          }
          const { signedUrl, path, publicUrl } = (await signedRes.json()) as {
            signedUrl: string;
            path: string;
            publicUrl: string;
          };

          try {
            await uploadToSignedUrl(
              signedUrl,
              file,
              file.type || 'application/octet-stream',
              (pct) => updateUpload(u.id, { progress: pct }),
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : `Upload failed for ${file.name}`;
            updateUpload(u.id, { status: 'error', error: msg });
            throw new Error(msg);
          }

          updateUpload(u.id, { status: 'registering', progress: 100 });

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
            const msg = j.error ?? `Failed to register ${file.name}`;
            updateUpload(u.id, { status: 'error', error: msg });
            throw new Error(msg);
          }
          const reg = (await regRes.json()) as { asset?: VenueMediaAssetRow };
          if (reg.asset) added.push(reg.asset);
          updateUpload(u.id, { status: 'done', progress: 100 });
        }

        await load();
        // Auto-clear successful uploads after a short visible period.
        setTimeout(() => sweepFinishedUploads(), PROGRESS_TICK_RESET_MS);
        return added;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
        return added;
      } finally {
        setUploading(false);
      }
    },
    [load, updateUpload, sweepFinishedUploads],
  );

  const remove = useCallback(async (id: string) => {
    setError('');
    const res = await fetch(`/api/venue-media/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? 'Delete failed');
      return false;
    }
    setAssets((prev) => prev.filter((a) => a.id !== id));
    return true;
  }, []);

  const rename = useCallback(async (id: string, displayName: string) => {
    setError('');
    const res = await fetch(`/api/venue-media/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? 'Rename failed');
      return false;
    }
    const data = (await res.json()) as { asset?: VenueMediaAssetRow };
    if (data.asset) {
      setAssets((prev) => prev.map((a) => (a.id === id ? data.asset! : a)));
    }
    return true;
  }, []);

  const dismissUpload = useCallback((id: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  }, []);

  return {
    assets,
    loading,
    uploading,
    error,
    setError,
    reload: load,
    uploadFiles,
    remove,
    rename,
    uploads,
    dismissUpload,
  };
}
