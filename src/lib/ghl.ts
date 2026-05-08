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
  message: string,
  attachments?: string[],
) {
  const cid = String(contactId ?? '').trim();
  if (!cid) {
    throw new Error('GHL sendSms: contactId is required');
  }

  // Exchange agency token → location token if needed
  const token = await resolveLocationToken(accessToken, locationId);

  // Get or create a conversation, then send SMS through it
  try {
    let conversationId: string | null = await getGhlConversationIdForContact(accessToken, locationId, cid);

    if (!conversationId) {
      const newConv = await ghlRequest('/conversations/', token, {
        method: 'POST',
        body: { locationId, contactId: cid },
        locationId,
      });
      conversationId = newConv?.conversation?.id || newConv?.id;
    }

    if (conversationId) {
      // GHL requires contactId on this route even when conversationId is set (otherwise 404 "Contact id not given").
      const msgBody: Record<string, unknown> = { type: 'SMS', conversationId, contactId: cid, message, locationId };
      if (attachments?.length) msgBody.attachments = attachments;
      const result = await ghlRequest('/conversations/messages', token, {
        method: 'POST',
        body: msgBody,
        locationId,
      });
      console.log(`[ghl] SMS sent via conversation ${conversationId}`);
      return result;
    }
  } catch (err) {
    console.error('[ghl] sendSms conversation path failed, trying direct:', err);
  }

  // Direct fallback (contact only — still must include contactId)
  const fallbackBody: Record<string, unknown> = { type: 'SMS', contactId: cid, message, locationId };
  if (attachments?.length) fallbackBody.attachments = attachments;
  return ghlRequest('/conversations/messages', token, {
    method: 'POST',
    body: fallbackBody,
    locationId,
  });
}

/**
 * Conversation ids for a contact, best-first for SMS: TYPE_SMS / SMS channel sorts ahead of email threads.
 * A contact often has multiple GHL conversations; inbound texts may not be on conversations[0].
 */
export async function listGhlConversationIdsForContactOrdered(
  accessToken: string,
  locationId: string,
  contactId: string,
  searchLimit = 25
): Promise<string[]> {
  const token = await resolveLocationToken(accessToken, locationId);
  const convRes = await ghlRequest(
    `/conversations/search?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(contactId)}&limit=${searchLimit}`,
    token,
    { locationId }
  );
  const list = (convRes?.conversations ?? []) as Record<string, unknown>[];
  const scored = list
    .map((c) => {
      const id = c.id != null ? String(c.id) : '';
      if (!id) return null;
      const lm = String(c.lastMessageType ?? '').toUpperCase();
      let score = lm.includes('SMS') ? 20 : 0;
      const lom = String(
        (c as { lastOutboundMessageType?: string }).lastOutboundMessageType ?? ''
      ).toUpperCase();
      if (lom.includes('SMS')) score += 8;
      const lmm = String((c as { lastManualMessageChannel?: string }).lastManualMessageChannel ?? '').toUpperCase();
      if (lmm === 'SMS') score += 12;
      const lu = c.dateUpdated ?? c.updatedAt ?? c.lastMessageDate ?? c.createdAt ?? '';
      const ts = new Date(String(lu || 0)).getTime() || 0;
      return { id, score, ts };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  scored.sort((a, b) => (b.score - a.score) || (b.ts - a.ts));
  return scored.map((s) => s.id);
}

/** Best conversation id for SMS-heavy use (first after SMS-prioritized ordering). */
export async function getGhlConversationIdForContact(
  accessToken: string,
  locationId: string,
  contactId: string
): Promise<string | null> {
  const ids = await listGhlConversationIdsForContactOrdered(accessToken, locationId, contactId, 25);
  return ids[0] ?? null;
}

/** List messages in a conversation (inbound replies appear here even when webhooks are not configured). */
export async function listGhlConversationMessages(
  accessToken: string,
  locationId: string,
  conversationId: string
): Promise<unknown> {
  const token = await resolveLocationToken(accessToken, locationId);
  return ghlRequest(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    token,
    { locationId }
  );
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

/** Fetch a single contact from GHL (for webhook enrichment). */
export async function getGhlContact(accessToken: string, locationId: string, contactId: string) {
  const token = await resolveLocationToken(accessToken, locationId);
  return ghlRequest(`/contacts/${encodeURIComponent(contactId)}`, token, { locationId });
}

/**
 * Delete a contact from GHL. Used when the venue owner manually removes a
 * contact from StoryVenue — without this the contact would resync back from
 * GHL the next time we read contacts.
 *
 * Returns `true` on a 200/204 (or 404 — already gone is fine), `false`
 * otherwise. Never throws so callers can treat it as best-effort cleanup.
 */
export async function deleteGhlContact(
  accessToken: string,
  locationId: string,
  contactId: string,
): Promise<boolean> {
  try {
    const token = await resolveLocationToken(accessToken, locationId);
    const res = await fetch(
      `${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          Version: '2021-07-28',
          'X-Location-Id': locationId,
        },
      },
    );
    return res.ok || res.status === 404;
  } catch (err) {
    console.warn('[deleteGhlContact] error:', err);
    return false;
  }
}

export async function findOrCreateContact(
  accessToken: string,
  locationId: string,
  contact: { email?: string; phone?: string; firstName?: string; lastName?: string }
) {
  const token = await resolveLocationToken(accessToken, locationId);

  // Normalise phone to E.164 before every GHL call.
  const normalizedPhone = contact.phone ? normalizePhone(contact.phone) : undefined;

  // Build a payload without undefined values — GHL's strict schema
  // validators reject unknown/undefined keys on some account configurations.
  const basePayload: Record<string, string | undefined> = {
    firstName: contact.firstName,
    lastName:  contact.lastName,
    email:     contact.email,
    phone:     normalizedPhone ?? undefined,
  };
  // Drop keys whose value is undefined
  const cleanPayload = Object.fromEntries(
    Object.entries(basePayload).filter(([, v]) => v !== undefined)
  );

  const identifier = contact.email || normalizedPhone;
  if (!identifier) throw new Error('findOrCreateContact: email or phone required');

  // ── 1. Look up existing contact ─────────────────────────────────────────
  const searchKey = contact.email ? 'email' : 'phone';
  let existingId: string | null = null;
  try {
    const searchRes = await ghlRequest(
      `/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&${searchKey}=${encodeURIComponent(identifier)}`,
      token,
      { locationId }
    );
    existingId = searchRes.contact?.id ?? null;
  } catch {
    // Non-fatal — fall through to creation
  }

  if (existingId) return existingId;

  // ── 2. Create the contact ────────────────────────────────────────────────
  // GHL's /contacts/ endpoint has two known failure modes we recover from:
  //   (a) 422 "property phone should not exist" — retry without `phone`,
  //       then PATCH it on separately.
  //   (b) 400 "does not allow duplicated contacts" — the body contains the
  //       existing contactId in `meta.contactId`; extract and return it.
  let contactId: string | null = null;
  const createRaw = await fetch(`${GHL_API_BASE}/contacts/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Version: '2021-07-28',
      ...(locationId ? { 'X-Location-Id': locationId } : {}),
    },
    body: JSON.stringify({ locationId, ...cleanPayload }),
  });

  if (createRaw.ok) {
    const createRes = await createRaw.json();
    contactId = createRes.contact?.id ?? null;
  } else {
    const errText = await createRaw.text();
    let errJson: { statusCode?: number; message?: string; meta?: { contactId?: string } } = {};
    try { errJson = JSON.parse(errText); } catch { /* ignore */ }

    // GHL returns 400 with existing contactId when duplicates aren't allowed
    if (errJson.meta?.contactId) {
      contactId = errJson.meta.contactId;
    } else if (createRaw.status === 422 && errText.toLowerCase().includes('phone')) {
      // Retry without `phone` field
      const { phone: _p, ...payloadWithoutPhone } = cleanPayload as Record<string, string>;
      const retryRaw = await fetch(`${GHL_API_BASE}/contacts/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Version: '2021-07-28',
          ...(locationId ? { 'X-Location-Id': locationId } : {}),
        },
        body: JSON.stringify({ locationId, ...payloadWithoutPhone }),
      });
      if (retryRaw.ok) {
        const retryRes = await retryRaw.json();
        contactId = retryRes.contact?.id ?? null;
      } else {
        const retryErr = await retryRaw.text();
        let retryJson: { meta?: { contactId?: string } } = {};
        try { retryJson = JSON.parse(retryErr); } catch { /* ignore */ }
        if (retryJson.meta?.contactId) {
          contactId = retryJson.meta.contactId;
        } else {
          throw new Error(`GHL API error ${retryRaw.status}: ${retryErr}`);
        }
      }
    } else {
      throw new Error(`GHL API error ${createRaw.status}: ${errText}`);
    }
  }

  // ── 3. Patch phone if contact was created without it ────────────────────
  if (contactId && normalizedPhone && !cleanPayload.phone) {
    try {
      await ghlRequest(`/contacts/${encodeURIComponent(contactId)}`, token, {
        method: 'PUT',
        body: { phone: normalizedPhone, locationId },
        locationId,
      });
    } catch {
      // Non-fatal — contact exists but may lack phone in GHL; SMS will still
      // work if the conversation is created with the contactId.
      console.warn('[ghl] findOrCreateContact: could not patch phone onto new contact', contactId);
    }
  }

  return contactId;
}

// ── DND types ─────────────────────────────────────────────────────────────────

export interface GhlDndChannelSetting {
  status: 'active' | 'inactive' | string;
  message?: string;
  code?: string;
}

/** Outbound DND — one entry per channel. "active" = DND on (contact blocked). */
export interface GhlDndSettings {
  Call?: GhlDndChannelSetting;
  Email?: GhlDndChannelSetting;
  SMS?: GhlDndChannelSetting;
  WhatsApp?: GhlDndChannelSetting;
  GMB?: GhlDndChannelSetting;
  FB?: GhlDndChannelSetting;
}

/** Inbound DND — controls whether the contact can initiate contact. */
export interface GhlInboundDndSettings {
  all?: GhlDndChannelSetting;
}

/**
 * Push DND changes for a single contact to GHL.
 *
 * Pass the full desired state of `dndSettings` and/or `inboundDndSettings`.
 * The master `dnd` flag is derived automatically: true when ANY outbound channel is "active".
 */
export async function updateGhlContactDnd(
  accessToken: string,
  locationId: string,
  contactId: string,
  dndSettings: GhlDndSettings,
  inboundDndSettings?: GhlInboundDndSettings,
): Promise<void> {
  const token = await resolveLocationToken(accessToken, locationId);

  // Derive the master dnd flag: true when any outbound channel has status "active"
  const dndMaster = Object.values(dndSettings).some(
    (ch) => (ch as GhlDndChannelSetting | undefined)?.status === 'active'
  );

  const body: Record<string, unknown> = {
    dnd: dndMaster,
    dndSettings,
  };
  if (inboundDndSettings) body.inboundDndSettings = inboundDndSettings;

  await ghlRequest(`/contacts/${encodeURIComponent(contactId)}`, token, {
    method: 'PUT',
    body,
    locationId,
  });
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
