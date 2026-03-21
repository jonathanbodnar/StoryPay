const GHL_API_BASE = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';

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
  return ghlRequest('/conversations/messages', accessToken, {
    method: 'POST',
    body: {
      type: 'SMS',
      contactId,
      message,
    },
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
  const identifier = contact.email || contact.phone;
  const searchKey = contact.email ? 'email' : 'phone';
  const searchRes = await ghlRequest(
    `/contacts/search/duplicate?locationId=${locationId}&${searchKey}=${encodeURIComponent(identifier!)}`,
    accessToken,
    { locationId }
  );

  if (searchRes.contact?.id) return searchRes.contact.id;

  const createRes = await ghlRequest('/contacts/', accessToken, {
    method: 'POST',
    body: { locationId, ...contact },
    locationId,
  });

  return createRes.contact?.id;
}

export function getOAuthUrl(clientId: string, redirectUri: string, state: string) {
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: redirectUri,
    client_id: clientId,
    scope: 'conversations.message.write conversations.message.readonly conversations.readonly contacts.write contacts.readonly locations.readonly',
    state,
  });
  return `https://marketplace.gohighlevel.com/oauth/chooselocation?${params}`;
}

export async function agencyGhlRequest(
  path: string,
  options: { method?: string; body?: Record<string, unknown> } = {}
) {
  const apiKey = process.env.GHL_AGENCY_API_KEY;
  const locationId = process.env.GHL_AGENCY_LOCATION_ID;
  if (!apiKey || !locationId) {
    throw new Error('GHL agency API key or location ID not configured');
  }
  return ghlRequest(path, apiKey, { ...options, locationId });
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
