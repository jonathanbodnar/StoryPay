/**
 * Purge the public directory's ISR cache.
 *
 * The public directory (homepage "Featured Venues", etc.) is a SEPARATE Next.js
 * deployment (the `weddingdirectory` app at storyvenue.com) that reads the same
 * Supabase project StoryPay writes to. Because it's a different deployment,
 * StoryPay's own `revalidatePath` can't touch its cache — a venue deleted or
 * unpublished here can linger on the directory homepage until its ISR window
 * (revalidate = 120s) lapses.
 *
 * This calls the directory's `/api/revalidate` webhook so those pages refresh
 * within seconds. Best-effort and fully no-op when `DIRECTORY_REVALIDATE_SECRET`
 * isn't configured, so it never blocks or breaks the triggering admin/owner
 * action.
 */

const DIRECTORY_BASE = (process.env.NEXT_PUBLIC_DIRECTORY_URL || 'https://storyvenue.com').replace(/\/$/, '');

export async function revalidateDirectory(opts?: { slug?: string | null }): Promise<void> {
  const secret = process.env.DIRECTORY_REVALIDATE_SECRET;
  if (!secret) return; // not configured → skip silently
  try {
    await fetch(`${DIRECTORY_BASE}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify({ slug: opts?.slug ?? null }),
      // Never let a slow/unhealthy directory hold up the admin/owner action.
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.warn('[directory-revalidate] failed (non-fatal):', e);
  }
}
