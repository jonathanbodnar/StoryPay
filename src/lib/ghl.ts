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
    contactId?: string;
    emailTo: string;
    subject: string;
    htmlBody: string;
    fromName?: string;
    fromEmail?: string;
  }
) {
  return ghlRequest('/conversations/messages', accessToken, {
    method: 'POST',
    body: {
      type: 'Email',
      ...data,
    },
    locationId,
  });
}

export function getOAuthUrl(clientId: string, redirectUri: string, state: string) {
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: redirectUri,
    client_id: clientId,
    scope: 'conversations.message.write conversations.message.readonly contacts.readonly locations.readonly',
    state,
  });
  return `https://marketplace.gohighlevel.com/oauth/chooselocation?${params}`;
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
