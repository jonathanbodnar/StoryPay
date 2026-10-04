'use client';

/**
 * Admin → Setup guide: the video for each lesson of the venues' Setup Guide.
 * A lesson with no link shows its cover and written steps; paste a link and
 * the cover gets a play button. No release needed.
 */

import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { SETUP_LESSONS, videoEmbedUrl } from '@/lib/setup-guide';
import { LessonThumb } from '@/components/setup-guide/LessonCover';

export default function SetupGuideAdminPanel() {
  const [videos, setVideos] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/setup-guide', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then((d: { videos: Record<string, string> }) => { if (!cancelled) setVideos(d.videos); })
      .catch(() => { if (!cancelled) setError('Could not load the videos. Refresh to try again.'); });
    return () => { cancelled = true; };
  }, []);

  async function save() {
    if (!videos) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch('/api/admin/setup-guide', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videos }),
      });
      const data = (await res.json().catch(() => ({}))) as { videos?: Record<string, string>; error?: string };
      if (!res.ok || !data.videos) {
        setError(data.error || 'Could not save the videos.');
        return;
      }
      setVideos(data.videos);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h2 className="font-heading text-xl font-semibold text-gray-900">Setup guide</h2>
      <p className="mt-1 text-sm leading-relaxed text-gray-500">
        New venues see this guide a few seconds after every sign-in until each step is done. Paste a YouTube, Vimeo,
        Loom, Wistia or Cloudflare Stream link to give a lesson its video. A lesson with no link shows its cover and
        written steps.
      </p>

      {!videos && !error && (
        <div className="mt-6 flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={15} className="animate-spin" /> Loading…
        </div>
      )}

      {videos && (
        <>
          <ol className="mt-6 space-y-3">
            {SETUP_LESSONS.map((lesson, i) => {
              const link = videos[lesson.id] ?? '';
              const invalid = link.trim() !== '' && !videoEmbedUrl(link);
              return (
                <li key={lesson.id} className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-4">
                  <LessonThumb lesson={lesson} className="mt-0.5 hidden w-[120px] shrink-0 sm:block" />
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`setup-video-${lesson.id}`} className="block">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        Step {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="block text-sm font-semibold text-gray-900">{lesson.title}</span>
                    </label>
                    <input
                      id={`setup-video-${lesson.id}`}
                      type="url"
                      inputMode="url"
                      value={link}
                      onChange={(e) => {
                        setSaved(false);
                        setVideos({ ...videos, [lesson.id]: e.target.value });
                      }}
                      placeholder="Paste a video link (leave empty for the cover)"
                      className={`mt-2 w-full rounded-xl border px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-gray-900 ${invalid ? 'border-red-300' : 'border-gray-200'}`}
                    />
                    {invalid && (
                      <p className="mt-1.5 text-xs text-red-600">
                        That link isn&apos;t a YouTube, Vimeo, Loom, Wistia or Cloudflare Stream video.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-[#1b1b1b] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
            >
              {saving && <Loader2 size={15} className="animate-spin" />} Save videos
            </button>
            {saved && (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                <Check size={15} /> Saved. Venues see it right away.
              </span>
            )}
          </div>
        </>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
  );
}
