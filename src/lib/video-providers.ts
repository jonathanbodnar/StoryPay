// Lightweight, dependency-free parser for video URLs used by the
// email builder's video block. Returns a normalized "watch URL" that
// always opens in a new browser tab and (when possible) a thumbnail
// URL we can use as the preview image inside the email + canvas.

export type VideoProvider = 'youtube' | 'vimeo' | 'loom' | 'wistia' | 'generic';

export interface ParsedVideo {
  provider: VideoProvider;
  /** External id when we could extract one (YouTube/Vimeo/Loom). */
  id?: string;
  /** Canonical URL we should link the thumbnail to. */
  watchUrl: string;
  /** Thumbnail URL — only YouTube has a fully public, no-API option. */
  thumbnail?: string;
  /** Friendly label for UI hints. */
  label: string;
}

function safeUrl(raw: string): URL | null {
  try {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '').toLowerCase();

  // youtu.be/<id>
  if (host === 'youtu.be') {
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg ? seg.split('?')[0] : null;
  }

  // youtube.com/...
  if (host.endsWith('youtube.com') || host === 'youtube-nocookie.com') {
    // /watch?v=ID
    const v = u.searchParams.get('v');
    if (v) return v;

    // /embed/ID, /shorts/ID, /live/ID, /v/ID
    const parts = u.pathname.split('/').filter(Boolean);
    const head = parts[0]?.toLowerCase();
    if ((head === 'embed' || head === 'shorts' || head === 'live' || head === 'v') && parts[1]) {
      return parts[1];
    }
  }
  return null;
}

function vimeoId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (!host.endsWith('vimeo.com')) return null;
  // vimeo.com/<id>  OR  vimeo.com/channels/<channel>/<id>  OR  player.vimeo.com/video/<id>
  const parts = u.pathname.split('/').filter(Boolean);
  // try last segment that's purely numeric
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(parts[i])) return parts[i];
  }
  return null;
}

function loomId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (!host.endsWith('loom.com')) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  // /share/<id>, /embed/<id>
  if ((parts[0] === 'share' || parts[0] === 'embed') && parts[1]) return parts[1];
  return null;
}

function wistiaId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (!host.endsWith('wistia.com') && !host.endsWith('wistia.net') && !host.endsWith('wi.st')) return null;
  // <subdomain>.wistia.com/medias/<id>  or  fast.wistia.net/embed/iframe/<id>
  const parts = u.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'medias' || p === 'iframe');
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return null;
}

/** Returns null if `raw` isn't even a URL-like string. */
export function parseVideoUrl(raw: string | undefined | null): ParsedVideo | null {
  if (!raw) return null;
  const u = safeUrl(raw);
  if (!u) return null;

  const yt = youtubeId(u);
  if (yt) {
    return {
      provider: 'youtube',
      id: yt,
      watchUrl: `https://www.youtube.com/watch?v=${yt}`,
      // hqdefault is universally available and 480x360 — perfect for emails.
      // maxresdefault would be sharper but doesn't exist for every video.
      thumbnail: `https://img.youtube.com/vi/${yt}/hqdefault.jpg`,
      label: 'YouTube',
    };
  }

  const v = vimeoId(u);
  if (v) {
    return {
      provider: 'vimeo',
      id: v,
      watchUrl: `https://vimeo.com/${v}`,
      // Vimeo thumbnails require an API call (vimeo.com/api/v2/video/<id>.json),
      // so we leave it undefined and let the user supply a thumbnail.
      label: 'Vimeo',
    };
  }

  const l = loomId(u);
  if (l) {
    return {
      provider: 'loom',
      id: l,
      watchUrl: `https://www.loom.com/share/${l}`,
      // Loom exposes a public thumbnail at this path for shared videos.
      thumbnail: `https://cdn.loom.com/sessions/thumbnails/${l}-with-play.gif`,
      label: 'Loom',
    };
  }

  const w = wistiaId(u);
  if (w) {
    return {
      provider: 'wistia',
      id: w,
      watchUrl: `https://fast.wistia.net/embed/iframe/${w}`,
      label: 'Wistia',
    };
  }

  // Anything else — keep the raw URL so the email link still works.
  return {
    provider: 'generic',
    watchUrl: u.toString(),
    label: u.hostname.replace(/^www\./, ''),
  };
}
