/**
 * Thin fetch wrapper that retries a gateway-level failure (502/503/504)
 * after a short, increasing delay.
 *
 * WHY: our in-app cron scheduler (src/lib/in-app-scheduler.ts) polls GHL
 * every ~7s from the same Node process that serves live traffic. Outbound
 * sends that also hit GHL (SMS/email compose, bride replies) can very
 * occasionally land in that brief contention window and come back as a
 * bare 502 with no error body — a real send failure the user has to notice
 * and manually retry. These status codes are inherently transient/infra-level
 * (never a validation or auth problem), so a couple of silent retries are
 * safe: on both the app-level and platform-level paths that produce a 502
 * here, no partial send has occurred yet.
 *
 * Never retries 4xx (real errors) or on the final attempt — callers should
 * still handle a non-ok response exactly as before.
 */
export async function fetchWithGatewayRetry(
  url: string,
  init: RequestInit,
  opts: { retries?: number; delayMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 2;
  const delayMs = opts.delayMs ?? 700;

  let res = await fetch(url, init);
  let attempt = 0;
  while (!res.ok && [502, 503, 504].includes(res.status) && attempt < retries) {
    attempt++;
    await new Promise((r) => setTimeout(r, delayMs * attempt));
    res = await fetch(url, init);
  }
  return res;
}
