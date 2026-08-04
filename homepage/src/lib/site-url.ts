/**
 * Normalizes a site-URL env var into an absolute URL safe for `new URL(...)`.
 *
 * Railway (and other hosts) sometimes inject bare-hostname env vars (e.g. an
 * old `*.up.railway.app` default domain with no scheme). Passing a bare
 * hostname straight into `new URL()` throws `ERR_INVALID_URL` and crashes the
 * entire build during static generation — this guards against that class of
 * misconfiguration by assuming `https://` when no scheme is present.
 */
export function siteUrl(raw: string | null | undefined, fallback: string): string {
  const v = (raw ?? '').trim();
  if (!v) return fallback;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}
