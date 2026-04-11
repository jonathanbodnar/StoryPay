const GHL_API_BASE = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';

/**
 * Resolve the best available GHL access token for a venue.
 *
 * Priority:
 *   1. Per-venue OAuth access token (stored after the user connects via Settings)
 *   2. GHL_PRIVATE_KEY env var — a single Private Integration API key that
 *      works for all sub-accounts under your GHL agency. Set this once in
 *      Railway/Vercel and every venue gets SMS without any OAuth flow.
 *
 * GHL Private Integration keys are created at:
 *   GHL Agency → Settings → Integrations → Private Integration Keys
 *
 * Returns null if no token is available (SMS will be skipped).
 */
export function getGhlToken(venue: {
  ghl_access_token?: string | null;
}): string | null {
  if (venue.ghl_access_token) return venue.ghl_access_token;
  // GHL_AGENCY_API_KEY is the agency-level JWT already set in Railway
  if (process.env.GHL_AGENCY_API_KEY) return process.env.GHL_AGENCY_API_KEY;
  // legacy alias
  if (process.env.GHL_PRIVATE_KEY) return process.env.GHL_PRIVATE_KEY;
  return null;
}

/**
 * Normalize any US phone number to E.164 format (+1XXXXXXXXXX).
 * GHL rejects numbers that are not in E.164 — this is the primary
 * reason SMS fails when phone numbers are entered in display format.
 *
 * Returns null if the input cannot be parsed as a valid US number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export async function ghlRequest(
  path: string,
  accessToken: string,
  options: { method?: string; body?: Record<string, unknown>; locationId?: string } = {}
) {
  const { method = 'GET', body, locationId } = options;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };
  if (locationId) headers['X-Location-Id'] = locationId;

  const res = await fetch(`${GHL_API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GHL API error ${res.status}: ${errorText}`);
  }

  return res.json();
}

/**
 * Get a location-scoped access token from the agency JWT.
 * The GHL_AGENCY_API_KEY is agency-level and must be exchanged for a
 * location token before making location-scoped API calls (SMS, contacts, etc.)
 */
async function getLocationToken(agencyToken: string, locationId: string): Promise<string> {
  const res = await fetch(`${GHL_API_BASE}/oauth/locationToken`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agencyToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Version': '2021-07-28',
    },
    body: new URLSearchParams({ companyId: locationId, locationId }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GHL location token exchange failed ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.access_token || data.token;
}

/**
 * Resolve a location-scoped token. If the provided token is an agency JWT
 * (detected by the presence of GHL_AGENCY_API_KEY matching it), exchange it
 * for a location token first. Otherwise use it directly.
 */
async function resolveLocationToken(token: string, locationId: string): Promise<string> {
  const isAgencyToken = process.env.GHL_AGENCY_API_KEY && token === process.env.GHL_AGENCY_API_KEY;
  if (isAgencyToken) {
    try {
      return await getLocationToken(token, locationId);
    } catch (err) {
      console.error('[ghl] location token exchange failed, falling back to agency token:', err);
      return token; // fall back — may still work for some endpoints
    }
  }
  return token;
}

export async function sendSms(
  accessToken: string,
  locationId: string,
  contactId: string,
  message: string
) {
  // Exchange agency token → location token if needed
  const token = await resolveLocationToken(accessToken, locationId);

  // Get or create a conversation, then send SMS through it
  try {
    const convRes = await ghlRequest(
      `/conversations/search?locationId=${locationId}&contactId=${contactId}&limit=1`,
      token,
      { locationId }
    );
    let conversationId = convRes?.conversations?.[0]?.id;

    if (!conversationId) {
      const newConv = await ghlRequest('/conversations/', token, {
        method: 'POST',
        body: { locationId, contactId },
        locationId,
      });
      conversationId = newConv?.conversation?.id || newConv?.id;
    }

    if (conversationId) {
      const result = await ghlRequest('/conversations/messages', token, {
        method: 'POST',
        body: { type: 'SMS', conversationId, message, locationId },
        locationId,
      });
      console.log(`[ghl] SMS sent via conversation ${conversationId}`);
      return result;
    }
  } catch (err) {
    console.error('[ghl] sendSms conversation path failed, trying direct:', err);
  }

  // Direct fallback
  return ghlRequest('/conversations/messages', token, {
    method: 'POST',
    body: { type: 'SMS', contactId, message, locationId },
    locationId,
  });
}

export async function sendEmail(
  accessToken: string,
  locationId: string,
  data: {
    contactId: string;
    subject: string;
    message?: string;
    html?: string;
  }
) {
  return ghlRequest('/conversations/messages', accessToken, {
    method: 'POST',
    body: {
      type: 'Email',
      contactId: data.contactId,
      subject: data.subject,
      message: data.message,
      html: data.html,
    },
    locationId,
  });
}

export async function findOrCreateContact(
  accessToken: string,
  locationId: string,
  contact: { email: string; phone?: string; firstName?: string; lastName?: string }
) {
  const token = await resolveLocationToken(accessToken, locationId);

  // Always normalize phone to E.164 before sending to GHL
  const normalizedPhone = contact.phone ? normalizePhone(contact.phone) : undefined;
  const contactPayload = { ...contact, ...(normalizedPhone ? { phone: normalizedPhone } : { phone: undefined }) };

  const identifier = contactPayload.email || normalizedPhone;
  const searchKey = contactPayload.email ? 'email' : 'phone';
  const searchRes = await ghlRequest(
    `/contacts/search/duplicate?locationId=${locationId}&${searchKey}=${encodeURIComponent(identifier!)}`,
    token,
    { locationId }
  );

  if (searchRes.contact?.id) return searchRes.contact.id;

  const createRes = await ghlRequest('/contacts/', token, {
    method: 'POST',
    body: { locationId, ...contactPayload },
    locationId,
  });

  return createRes.contact?.id;
}

export function getOAuthUrl(clientId: string, redirectUri: string, state: string) {
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: redirectUri,
    client_id: clientId,
    scope: 'conversations/message.write conversations/message.readonly conversations.readonly conversations.write contacts.write contacts.readonly locations.readonly',
    state,
  });
  return `https://marketplace.leadconnectorhq.com/oauth/chooselocation?${params}`;
}

export async function refreshAccessToken(refreshToken: string) {
  const res = await fetch('https://services.leadconnectorhq.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.GHL_CLIENT_ID!,
      client_secret: process.env.GHL_CLIENT_SECRET!,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GHL token refresh error ${res.status}: ${errorText}`);
  }

  return res.json();
}

export async function exchangeCode(code: string, clientId: string, clientSecret: string, redirectUri: string) {
  const res = await fetch('https://services.leadconnectorhq.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GHL OAuth error ${res.status}: ${errorText}`);
  }

  return res.json();
}
