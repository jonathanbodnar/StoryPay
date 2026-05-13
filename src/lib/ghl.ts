const GHL_API_BASE = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
const GHL_API_V1_BASE = process.env.GHL_API_V1_BASE || 'https://rest.gohighlevel.com/v1';

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
 * Return the agency-level GHL key (or null if neither env var is set).
 *
 * Use this as a 401 fallback when the per-venue token is stale.  Callers
 * that get a 401 from GHL should:
 *   1. Check if the token they used was already the agency key → give up.
 *   2. Otherwise retry with `getGhlAgencyKey()` + `resolveLocationToken()`.
 */
export function getGhlAgencyKey(): string | null {
  if (process.env.GHL_AGENCY_API_KEY) return process.env.GHL_AGENCY_API_KEY;
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

/**
 * Translate v2 endpoint paths to their v1 equivalents where the shape differs.
 * For most contact paths the v1 endpoint structure is identical to v2 (just a
 * different base URL); we only need explicit rewrites for the handful that
 * diverge.
 */
function translateV2PathToV1(path: string): string {
  // v2 "/contacts/search" doesn't exist in v1 — caller should already avoid it
  // for v1 tokens, but be defensive.
  if (path.startsWith('/conversations/')) {
    // v1 messaging routes were /contacts/{id}/sms historically, but newer v1
    // implementations also accept /conversations/messages. Pass through and
    // let the caller construct an appropriate body shape (handled in sendSmsV1).
    return path;
  }
  return path;
}

export async function ghlRequest(
  path: string,
  accessToken: string,
  options: { method?: string; body?: Record<string, unknown>; locationId?: string } = {}
) {
  const { method = 'GET', body, locationId } = options;
  const kind = classifyToken(accessToken);
  const isV1 = kind === 'v1';

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  // v2 requires the Version header. v1 doesn't use it but tolerates it.
  if (!isV1) headers['Version'] = '2021-07-28';
  // v2 uses X-Location-Id; v1 doesn't recognise the header and prefers ?locationId= in the query.
  if (locationId && !isV1) headers['X-Location-Id'] = locationId;

  const base = isV1 ? GHL_API_V1_BASE : GHL_API_BASE;
  const effectivePath = isV1 ? translateV2PathToV1(path) : path;

  const res = await fetch(`${base}${effectivePath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GHL API error ${res.status}: ${errorText}`);
  }

  return res.json();
}

/**
 * Detect the GHL token type by looking at the string format and claims.
 *
 *   - "pit-..."  → Private Integration Token. Location-scoped, use as-is on v2.
 *   - v1 key     → JWT-formatted but with no `authClass` and no `exp` claims.
 *                  These are the legacy "Agency API Key" / "Location API Key"
 *                  issued via the v1 Settings UI. They only work against
 *                  rest.gohighlevel.com/v1/ endpoints — NOT v2.
 *   - v2 OAuth   → Real OAuth JWT with `authClass` (Agency or Location) and
 *                  `exp` claim. May need /oauth/locationToken exchange.
 *   - opaque     → Anything else (treated like v2 OAuth for safety).
 */
export type TokenKind = 'pit' | 'v1' | 'v2-oauth' | 'opaque';

export function classifyToken(token: string): TokenKind {
  if (!token) return 'opaque';
  if (token.startsWith('pit-')) return 'pit';
  const payload = decodeJwtPayload(token);
  if (!payload) return 'opaque';
  const hasAuthClass = typeof payload.authClass === 'string' && payload.authClass.length > 0;
  const hasExp = typeof payload.exp === 'number';
  // OAuth tokens always carry authClass+exp. Anything missing both is a v1 key.
  if (!hasAuthClass && !hasExp) return 'v1';
  return 'v2-oauth';
}

/**
 * Decode an unverified JWT payload. Returns null if the token is not a
 * valid JWT (e.g. a PIT or a legacy v1 key).
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // base64url → base64
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extract the companyId claim from a GHL agency JWT. Distinct from the
 * sub-account locationId and required by /oauth/locationToken.
 */
function extractCompanyId(agencyToken: string, fallbackLocationId: string): string {
  if (process.env.GHL_COMPANY_ID) return process.env.GHL_COMPANY_ID;
  const payload = decodeJwtPayload(agencyToken);
  if (payload) {
    const cid = payload.companyId ?? payload.company_id ?? payload.sub;
    if (typeof cid === 'string' && cid) return cid;
  }
  return fallbackLocationId;
}

/**
 * Build a human-readable diagnostic about a JWT's claims (without leaking the
 * token itself). Used to surface "your token is expired" / "wrong location"
 * errors clearly.
 */
function describeJwt(token: string): string {
  const p = decodeJwtPayload(token);
  if (!p) return 'token=<not a JWT>';
  const exp = typeof p.exp === 'number' ? p.exp : null;
  const iat = typeof p.iat === 'number' ? p.iat : null;
  const authClass = (p.authClass as string | undefined) ?? '<none>';
  const companyId = (p.companyId as string | undefined) ?? (p.company_id as string | undefined) ?? '<none>';
  const locationIdClaim = (p.locationId as string | undefined) ?? (p.location_id as string | undefined) ?? '<none>';
  const version = (p.version as string | number | undefined) ?? '<none>';
  const nowSec = Math.floor(Date.now() / 1000);
  const expIso = exp ? new Date(exp * 1000).toISOString() : '<none>';
  const iatIso = iat ? new Date(iat * 1000).toISOString() : '<none>';
  const expired = exp ? exp < nowSec : false;
  return `authClass=${authClass}, version=${version}, company_id=${companyId}, location_id=${locationIdClaim}, iat=${iatIso}, exp=${expIso}, expired=${expired}`;
}

/**
 * Returns true if the given v1 JWT carries a `location_id` claim matching the
 * target locationId. Returns false for agency-scoped v1 keys (no location_id)
 * and for keys scoped to a different location.
 */
export function v1KeyMatchesLocation(token: string, locationId: string): boolean {
  const p = decodeJwtPayload(token);
  if (!p) return false;
  const claim = (p.locationId as string | undefined) ?? (p.location_id as string | undefined);
  return typeof claim === 'string' && claim === locationId;
}

/**
 * Get the location-scoped v1 API key for a sub-account using the agency v1
 * key. v1 contact endpoints only accept location-scoped keys, so we need to
 * bootstrap from agency → location.
 *
 * GHL v1 surfaces each location's apiKey in `GET /v1/locations/` (list), not
 * always in `GET /v1/locations/{id}`. We try the single-location endpoint
 * first (fewer bytes, doesn't depend on pagination) and fall back to the
 * full list to scan for the matching location.
 *
 * Cached at the venue level (venues.ghl_access_token gets the location key
 * stored after the first successful lookup).
 */
export async function fetchV1LocationApiKey(agencyV1Key: string, locationId: string): Promise<string> {
  // 1. Try single-location endpoint
  {
    const res = await fetch(`${GHL_API_V1_BASE}/locations/${encodeURIComponent(locationId)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${agencyV1Key}`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      const k = pickApiKey(data);
      if (k) return k;
      // Fall through to list endpoint if the field isn't in this response shape.
    } else if (res.status !== 401 && res.status !== 403 && res.status !== 404) {
      const errText = await res.text();
      throw new Error(`GHL v1 single-location lookup failed ${res.status}: ${errText} (locationId=${locationId}, agency key ${describeJwt(agencyV1Key)})`);
    }
  }

  // 2. Fall back to listing all locations and finding ours
  const res = await fetch(`${GHL_API_V1_BASE}/locations/`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${agencyV1Key}`, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GHL v1 list-locations failed ${res.status}: ${errText} (agency key ${describeJwt(agencyV1Key)})`);
  }
  const list = await res.json() as { locations?: Array<Record<string, unknown>> };
  const locations = Array.isArray(list.locations) ? list.locations : [];
  if (locations.length === 0) {
    throw new Error(`GHL v1 list-locations returned no locations. Either your agency key has no sub-accounts assigned, or it's a location key (not an agency key). (agency key ${describeJwt(agencyV1Key)})`);
  }
  const match = locations.find(l => (l.id ?? l._id) === locationId);
  if (!match) {
    const ids = locations.slice(0, 5).map(l => String(l.id ?? l._id)).join(', ');
    throw new Error(`Sub-account ${locationId} not visible to your agency key. First few locations the key can see: [${ids}]${locations.length > 5 ? `, ... (${locations.length} total)` : ''}.`);
  }
  const k = pickApiKey(match);
  if (k) return k;
  // We found the location but it has no apiKey field — the location has never
  // had a v1 key generated, or the agency tier doesn't expose it.
  const keys = Object.keys(match).join(', ');
  throw new Error(`Location ${locationId} found but no v1 apiKey on the record (fields returned: ${keys}). The sub-account may not have a v1 API key provisioned, or your agency plan tier (needs Agency Pro) does not include API key visibility.`);
}

function pickApiKey(obj: Record<string, unknown>): string | null {
  const candidates = [obj.apiKey, obj.api_key, obj.locationApiKey, (obj.location as Record<string, unknown> | undefined)?.apiKey];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 10) return c;
  }
  return null;
}

/**
 * Get a location-scoped access token from the agency JWT.
 * The GHL_AGENCY_API_KEY is agency-level and must be exchanged for a
 * location token before making location-scoped API calls (SMS, contacts, etc.)
 */
async function getLocationToken(agencyToken: string, locationId: string): Promise<string> {
  const companyId = extractCompanyId(agencyToken, locationId);

  // Pre-flight: if the JWT exp claim says it's expired, fail fast with a
  // clear message rather than waiting for GHL to say "Invalid JWT".
  const payload = decodeJwtPayload(agencyToken);
  if (payload?.exp && typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error(`GHL agency token is expired (${describeJwt(agencyToken)}). Update GHL_AGENCY_API_KEY / GHL_PRIVATE_KEY in Railway with a fresh token, or switch to a Private Integration Token (pit-*).`);
  }

  const res = await fetch(`${GHL_API_BASE}/oauth/locationToken`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agencyToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Version': '2021-07-28',
    },
    body: new URLSearchParams({ companyId, locationId }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GHL location token exchange failed ${res.status}: ${err} (companyId=${companyId}, locationId=${locationId}, ${describeJwt(agencyToken)})`);
  }

  const data = await res.json();
  const tok = data.access_token || data.token;
  if (!tok) throw new Error(`GHL location token exchange returned no token: ${JSON.stringify(data)}`);
  return tok;
}

/**
 * Resolve a location-scoped token for use with location-scoped endpoints.
 * Behaviour by token type:
 *
 *   - PIT (pit-...):   Already location-scoped — return as-is.
 *   - v1 key:          Agency-wide v1 key. Pass through; ghlRequest will
 *                      automatically route it to v1 endpoints.
 *   - v2 OAuth JWT:    If already issued for this location, use directly.
 *                      Otherwise treat as an agency JWT and exchange.
 *   - opaque:          Use as-is (best effort).
 *
 * No silent fallback: if the v2 exchange fails, the error propagates so
 * callers see why instead of getting a confusing "Invalid JWT" downstream.
 */
export async function resolveLocationToken(token: string, locationId: string): Promise<string> {
  const kind = classifyToken(token);
  if (kind === 'pit' || kind === 'v1' || kind === 'opaque') return token;

  // v2-oauth path — inspect claims
  const payload = decodeJwtPayload(token);
  const authClass = (payload?.authClass as string | undefined)?.toLowerCase();
  const authClassId = payload?.authClassId as string | undefined;

  if (authClass === 'location' && authClassId === locationId) return token;

  return await getLocationToken(token, locationId);
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

  // v1 short-circuit: v1's /conversations/messages requires phone in the body
  // (it doesn't auto-resolve from contactId). The per-contact route is the
  // simplest reliable path:
  //
  //   POST /v1/contacts/{contactId}/sms  body: { message }
  //
  // GHL auto-uses the contact's stored primary phone.
  if (classifyToken(accessToken) === 'v1') {
    try {
      const body: Record<string, unknown> = { message };
      if (attachments?.length) body.attachments = attachments;
      const result = await ghlRequest(`/contacts/${encodeURIComponent(cid)}/sms`, accessToken, {
        method: 'POST',
        body,
        locationId,
      });
      console.log(`[ghl] SMS sent via v1 /contacts/${cid}/sms`);
      return result;
    } catch (perContactErr) {
      // Fallback: try the /conversations/messages route with phone resolved
      // from the contact record. Some v1 builds expose the SMS endpoint at
      // different paths.
      const perContactMsg = perContactErr instanceof Error ? perContactErr.message : String(perContactErr);
      console.warn(`[ghl] v1 /contacts/${cid}/sms failed, trying /conversations/messages with explicit phone:`, perContactMsg);

      let phone: string | null = null;
      try {
        const contact = await ghlRequest(`/contacts/${encodeURIComponent(cid)}`, accessToken, { locationId }) as {
          contact?: { phone?: string | null };
          phone?: string | null;
        };
        phone = contact.contact?.phone ?? contact.phone ?? null;
      } catch (lookupErr) {
        console.error('[ghl] v1 contact lookup for phone failed:', lookupErr);
      }
      if (!phone) {
        throw new Error(`Unable to resolve phone number for contact ${cid}. Original error: ${perContactMsg}`);
      }
      const body: Record<string, unknown> = { type: 'SMS', contactId: cid, phone, message };
      if (attachments?.length) body.attachments = attachments;
      const result = await ghlRequest('/conversations/messages', accessToken, {
        method: 'POST',
        body,
        locationId,
      });
      console.log(`[ghl] SMS sent via v1 /conversations/messages (explicit phone) to contact ${cid}`);
      return result;
    }
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
        signal: AbortSignal.timeout(30_000),
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
    signal: AbortSignal.timeout(30_000),
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
        signal: AbortSignal.timeout(30_000),
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
    signal: AbortSignal.timeout(30_000),
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
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GHL OAuth error ${res.status}: ${errorText}`);
  }

  return res.json();
}
