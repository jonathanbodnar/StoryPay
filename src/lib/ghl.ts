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

export async function sendSms(
  accessToken: string,
  locationId: string,
  contactId: string,
  message: string
) {
  // First create/get a conversation, then send SMS via that conversation
  // This uses GHL's messaging API which routes through the sub-account's A2P phone
  try {
    // Get or create conversation
    const convRes = await ghlRequest(
      `/conversations/search?locationId=${locationId}&contactId=${contactId}&limit=1`,
      accessToken,
      { locationId }
    );
    let conversationId = convRes?.conversations?.[0]?.id;

    if (!conversationId) {
      const newConv = await ghlRequest('/conversations/', accessToken, {
        method: 'POST',
        body: { locationId, contactId },
        locationId,
      });
      conversationId = newConv?.conversation?.id || newConv?.id;
    }

    if (conversationId) {
      return ghlRequest('/conversations/messages', accessToken, {
        method: 'POST',
        body: { type: 'SMS', conversationId, message, locationId },
        locationId,
      });
    }
  } catch {
    // Fallback to direct SMS
  }

  // Direct fallback
  return ghlRequest('/conversations/messages', accessToken, {
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
  // Always normalize phone to E.164 before sending to GHL
  const normalizedPhone = contact.phone ? normalizePhone(contact.phone) : undefined;
  const contactPayload = { ...contact, ...(normalizedPhone ? { phone: normalizedPhone } : { phone: undefined }) };

  const identifier = contactPayload.email || normalizedPhone;
  const searchKey = contactPayload.email ? 'email' : 'phone';
  const searchRes = await ghlRequest(
    `/contacts/search/duplicate?locationId=${locationId}&${searchKey}=${encodeURIComponent(identifier!)}`,
    accessToken,
    { locationId }
  );

  if (searchRes.contact?.id) return searchRes.contact.id;

  const createRes = await ghlRequest('/contacts/', accessToken, {
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
