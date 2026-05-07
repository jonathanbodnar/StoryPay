/**
 * Resend Domains API wrapper
 * https://resend.com/docs/api-reference/domains
 *
 * Used to provision per-venue custom sending domains. Resend handles all DKIM
 * key generation, DNS record provisioning, and ongoing verification — we just
 * call their API and store the results.
 */

export interface ResendDnsRecord {
  record: string;   // e.g. "TXT", "MX"
  name: string;     // e.g. "resend._domainkey"
  value: string;    // the record value
  ttl?: string | number;
  priority?: number;
  status: 'verified' | 'not_started' | 'failed';
}

export interface ResendDomain {
  id: string;
  name: string;
  status: 'not_started' | 'pending' | 'verified' | 'failed';
  records: ResendDnsRecord[];
  created_at: string;
  region?: string;
}

function resendApiKey(): string {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error('RESEND_API_KEY is not set');
  return key;
}

async function resendFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<{ data?: T; error?: string; status: number }> {
  const res = await fetch(`https://api.resend.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${resendApiKey()}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof body.message === 'string' ? body.message : JSON.stringify(body);
    return { error: msg, status: res.status };
  }
  return { data: body as T, status: res.status };
}

/**
 * Register a new domain with Resend and retrieve its DNS records.
 * Call this when a venue first connects their domain.
 */
export async function createResendDomain(
  domain: string,
): Promise<{ domain?: ResendDomain; error?: string }> {
  const { data, error } = await resendFetch<ResendDomain>('/domains', {
    method: 'POST',
    body: JSON.stringify({ name: domain.toLowerCase().trim() }),
  });
  if (error || !data) return { error: error ?? 'Failed to create domain' };
  return { domain: data };
}

/**
 * Fetch the current status and DNS records for an existing Resend domain.
 * Use this to poll for DKIM/SPF verification.
 */
export async function getResendDomain(
  domainId: string,
): Promise<{ domain?: ResendDomain; error?: string }> {
  const { data, error } = await resendFetch<ResendDomain>(`/domains/${domainId}`);
  if (error || !data) return { error: error ?? 'Domain not found' };
  return { domain: data };
}

/**
 * Trigger re-verification of a domain's DNS records.
 */
export async function verifyResendDomain(
  domainId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error, status } = await resendFetch(`/domains/${domainId}/verify`, {
    method: 'POST',
  });
  if (error && status !== 200) return { ok: false, error };
  return { ok: true };
}

/**
 * Delete a domain from Resend. Call when a venue removes their custom domain.
 */
export async function deleteResendDomain(
  domainId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error, status } = await resendFetch(`/domains/${domainId}`, {
    method: 'DELETE',
  });
  if (error && status !== 200 && status !== 204) return { ok: false, error };
  return { ok: true };
}

/**
 * Map a Resend domain status to our internal status value.
 */
export function mapResendStatus(
  resendStatus: string,
): 'not_configured' | 'pending' | 'verified' | 'failed' {
  switch (resendStatus) {
    case 'verified': return 'verified';
    case 'failed':   return 'failed';
    case 'pending':
    case 'not_started':
    default:         return 'pending';
  }
}
