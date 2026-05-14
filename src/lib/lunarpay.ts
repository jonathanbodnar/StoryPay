const LP_BASE_URL = process.env.LP_BASE_URL || 'https://app.lunarpay.com';
const LP_AGENCY_KEY = process.env.LP_AGENCY_KEY || '';

interface LPRequestOptions {
  method?: string;
  body?: Record<string, unknown>;
  key: string;
}

export async function lpFetch(path: string, { method = 'GET', body, key }: LPRequestOptions) {
  const url = `${LP_BASE_URL}${path}`;
  const keyPrefix = key ? `${key.slice(0, 10)}...${key.slice(-4)}` : '<empty>';
  console.log('[lpFetch] →', method, url, 'keyPrefix:', keyPrefix, 'hasBody:', !!body);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (fetchErr) {
    console.error('[lpFetch] fetch() threw (network/timeout):', fetchErr);
    throw fetchErr;
  }
  console.log('[lpFetch] ←', res.status, url);

  if (!res.ok) {
    const errorText = await res.text();
    // Log enough to debug, but redact PII fields from the request body.
    // Customer email/name/phone/amount must not land in production logs.
    const PII_FIELDS = new Set([
      'email', 'customer_email', 'customerEmail',
      'phone', 'customer_phone', 'customerPhone',
      'firstName', 'lastName', 'name', 'customer_name', 'customerName', 'nameHolder',
      'password',
      'amount', 'price',
      'description', 'success_url', 'cancel_url',
      'metadata',
    ]);
    const safeBody: Record<string, unknown> = {};
    if (body && typeof body === 'object') {
      for (const [k, v] of Object.entries(body)) {
        safeBody[k] = PII_FIELDS.has(k) ? '<redacted>' : v;
      }
    }
    // Capture response headers to distinguish gateway errors from LP errors.
    // "Missing Authentication Token" = AWS API Gateway (request never reached LP).
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { resHeaders[k] = v; });
    console.error('[lpFetch] LunarPay error', {
      url,
      method,
      status: res.status,
      keyPrefix,
      keyStartsWithLpSk: key.startsWith('lp_sk_'),
      keyLength: key.length,
      requestBody: safeBody,
      responseText: errorText.slice(0, 500),
      responseHeaders: resHeaders,
      isGatewayError: errorText.includes('Missing Authentication Token'),
    });
    throw new Error(`LunarPay API error ${res.status}: ${errorText}`);
  }

  return res.json();
}

// ── Agency endpoints (use LP_AGENCY_KEY) ────────────────────────────

export function agencyCreateMerchant(data: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  businessName: string;
}) {
  return lpFetch('/api/v1/agency/merchants', {
    method: 'POST',
    body: data as unknown as Record<string, unknown>,
    key: LP_AGENCY_KEY,
  });
}

export function agencyOnboardMerchant(merchantId: number, data: Record<string, unknown>) {
  return lpFetch(`/api/v1/agency/merchants/${merchantId}/onboard`, {
    method: 'POST',
    body: data,
    key: LP_AGENCY_KEY,
  });
}

export function agencyGetMerchant(merchantId: number) {
  return lpFetch(`/api/v1/agency/merchants/${merchantId}`, {
    key: LP_AGENCY_KEY,
  });
}

// ── Venue endpoints (use venue's own lp_sk_ key) ───────────────────

export function lunarpayRequest(
  path: string,
  { method = 'GET', body, secretKey }: { method?: string; body?: Record<string, unknown>; secretKey: string }
) {
  return lpFetch(path, { method, body, key: secretKey });
}

export function lunarpayPublishableRequest(
  path: string,
  { method = 'POST', body, publishableKey }: { method?: string; body?: Record<string, unknown>; publishableKey: string }
) {
  return lpFetch(path, { method, body, key: publishableKey });
}

/**
 * LunarPay's POST /v1/customers validator requires BOTH `firstName` and
 * `lastName` to be ≥1 character. Single-name contacts (e.g. "Cher", or a
 * venue called just "Acme") were tripping this — the request fails with
 * 400 `lastName: Too small`. This helper splits any free-form name into a
 * pair LP will accept, falling back to the email local-part / a dash when
 * no real name is available.
 */
export function splitCustomerName(
  fullName: string | null | undefined,
  emailFallback?: string | null,
): { firstName: string; lastName: string } {
  const raw = (fullName ?? '').trim().replace(/\s+/g, ' ');
  if (raw) {
    const parts = raw.split(' ');
    if (parts.length === 1) return { firstName: parts[0], lastName: '-' };
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
  }
  const local = (emailFallback ?? '').split('@')[0]?.trim() || 'Customer';
  return { firstName: local, lastName: '-' };
}

export function createCustomer(secretKey: string, data: Record<string, unknown>) {
  // Belt-and-suspenders: even if a caller forgot to use splitCustomerName,
  // make sure we never POST an empty lastName (LP's validator rejects it).
  const body: Record<string, unknown> = { ...data };
  const first = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const last  = typeof body.lastName  === 'string' ? body.lastName.trim()  : '';
  if (first || last) {
    if (!first) body.firstName = last || 'Customer';
    if (!last)  body.lastName  = '-';
  }
  return lpFetch('/api/v1/customers', { method: 'POST', body, key: secretKey });
}

export function listCustomers(secretKey: string, search?: string, page = 1, limit = 20) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set('search', search);
  return lpFetch(`/api/v1/customers?${params}`, { key: secretKey });
}

export function updateCustomer(secretKey: string, id: number, data: Record<string, unknown>) {
  return lpFetch(`/api/v1/customers/${id}`, { method: 'PUT', body: data, key: secretKey });
}

/**
 * Create a Fortis Elements payment intention. Per LP /developers docs there
 * are exactly two intention shapes the Elements iframe supports:
 *
 *   1. TRANSACTION intention — { amount, paymentMethods }
 *      • Fortis renders a normal payment form (no "save card" label).
 *      • Customer pays inside the iframe; Fortis charges the card directly.
 *      • The `done` event fires with transaction info (transaction_id etc).
 *      • Backend does NOT need to call /charges — just mark the invoice paid.
 *      Use for pay-in-full / one-time invoices.
 *
 *   2. TICKET intention — { hasRecurring: true, paymentMethods }
 *      • Fortis renders a "save card" form (no charge inside the iframe).
 *      • The `done` event fires with a ticket id.
 *      • Backend calls POST /customers/:id/payment-methods with the ticketId
 *        ($0.01 tokenize + instant refund) to get a paymentMethodId, then
 *        POST /charges for the first real payment, then POST /subscriptions
 *        or POST /payment-schedules for any recurring portion.
 *      Use for installments and saas/trial subscriptions.
 *
 * Field names are camelCase (paymentMethods, hasRecurring) per LP's Elements
 * API — different from the hosted /checkout/sessions endpoint which uses
 * snake_case (payment_methods).
 */
export function createIntention(
  publishableKey: string,
  amount?: number,
  options?: { paymentMethods?: string[]; hasRecurring?: boolean },
) {
  const body: Record<string, unknown> = {};
  if (options?.hasRecurring) {
    body.hasRecurring = true;
  } else if (amount) {
    body.amount = amount;
  } else {
    throw new Error('createIntention requires either an amount (transaction) or hasRecurring=true (ticket).');
  }
  if (options?.paymentMethods?.length) body.paymentMethods = options.paymentMethods;
  return lpFetch('/api/v1/intentions', {
    method: 'POST',
    body,
    key: publishableKey,
  });
}

/**
 * Save a payment method from a Fortis ticket (ticket_success event).
 * Per LP docs: $0.01 tokenization charge + instant refund, returns paymentMethodId.
 * The ticket can ONLY be used once with this endpoint — to charge, use
 * createCharge(customerId, paymentMethodId, ...) with the returned id.
 */
export function savePaymentMethod(
  secretKey: string,
  customerId: number,
  ticketId: string,
  nameHolder: string,
  options?: { paymentMethod?: string; setDefault?: boolean },
) {
  return lpFetch(`/api/v1/customers/${customerId}/payment-methods`, {
    method: 'POST',
    body: {
      ticketId,
      nameHolder,
      paymentMethod: options?.paymentMethod ?? 'cc',
      setDefault:    options?.setDefault    ?? true,
    },
    key: secretKey,
  });
}

/**
 * Compute the `startOn` value for a delayed-start LP subscription.
 *
 * LP's semantics: `nextPaymentOn = startOn + 1 frequency`. So to get the
 * FIRST recurring charge to fire on `firstChargeDate`, pass
 * `startOn = firstChargeDate - 1 frequency` to /subscriptions.
 *
 * Example: 14-day trial ending 2026-05-28, monthly billing →
 *   startOn = 2026-04-28 → nextPaymentOn = 2026-05-28 ✓
 */
export function computeSubscriptionStartOn(firstChargeDate: string | Date, frequency: string): string {
  const d = new Date(firstChargeDate);
  switch (frequency) {
    case 'weekly':    d.setDate(d.getDate() - 7); break;
    case 'monthly':   d.setMonth(d.getMonth() - 1); break;
    case 'quarterly': d.setMonth(d.getMonth() - 3); break;
    case 'yearly':    d.setFullYear(d.getFullYear() - 1); break;
    default:          d.setMonth(d.getMonth() - 1);
  }
  return d.toISOString();
}

export function listPaymentMethods(secretKey: string, customerId: number) {
  return lpFetch(`/api/v1/customers/${customerId}/payment-methods`, { key: secretKey });
}

export function deletePaymentMethod(secretKey: string, customerId: number, pmId: number) {
  return lpFetch(`/api/v1/customers/${customerId}/payment-methods/${pmId}`, {
    method: 'DELETE',
    key: secretKey,
  });
}

export function createCharge(secretKey: string, data: { customerId: number; paymentMethodId: number; amount: number; description: string }) {
  return lpFetch('/api/v1/charges', { method: 'POST', body: data as unknown as Record<string, unknown>, key: secretKey });
}

export function createPaymentSchedule(secretKey: string, data: Record<string, unknown>) {
  return lpFetch('/api/v1/payment-schedules', { method: 'POST', body: data, key: secretKey });
}

export function getPaymentSchedule(secretKey: string, id: number | string) {
  return lpFetch(`/api/v1/payment-schedules/${id}`, { key: secretKey });
}

export function listPaymentSchedules(secretKey: string, status?: string) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('limit', '100');
  const qs = params.toString();
  return lpFetch(`/api/v1/payment-schedules${qs ? `?${qs}` : ''}`, { key: secretKey });
}

export function createSubscription(secretKey: string, data: Record<string, unknown>) {
  return lpFetch('/api/v1/subscriptions', { method: 'POST', body: data, key: secretKey });
}

export function getSubscription(secretKey: string, id: number | string) {
  return lpFetch(`/api/v1/subscriptions/${id}`, { key: secretKey });
}

export function listSubscriptions(secretKey: string, status?: string) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('limit', '100');
  const qs = params.toString();
  return lpFetch(`/api/v1/subscriptions${qs ? `?${qs}` : ''}`, { key: secretKey });
}

export function updateSubscription(
  secretKey: string,
  id: number | string,
  data: { amount?: number; frequency?: string; nextPaymentOn?: string },
) {
  return lpFetch(`/api/v1/subscriptions/${id}`, {
    method: 'PATCH',
    body: data as unknown as Record<string, unknown>,
    key: secretKey,
  });
}

export function cancelSubscription(secretKey: string, id: number | string) {
  return lpFetch(`/api/v1/subscriptions/${id}`, { method: 'DELETE', key: secretKey });
}

export function getCustomer(secretKey: string, id: number | string) {
  return lpFetch(`/api/v1/customers/${id}`, { key: secretKey });
}

export function refundCharge(secretKey: string, chargeId: number | string, amountCents?: number) {
  const body = amountCents ? { amount: amountCents } : undefined;
  return lpFetch(`/api/v1/charges/${chargeId}/refund`, { method: 'POST', body, key: secretKey });
}

// ── Checkout Sessions ────────────────────────────────────────────────

export function createCheckoutSession(
  secretKey: string,
  data: Record<string, unknown>
) {
  const body: Record<string, unknown> = {};

  // Documented hosted-checkout fields per the LunarPay API spec.
  //
  // - mode: "subscription" | "installments" | omitted (one-off). When set,
  //   LP charges the card, vaults it, AND creates the recurring plan in one
  //   call — no separate createSubscription needed.
  // - recurring: { frequency: "weekly"|"monthly"|... , start_on?: ISO datetime, trial?: boolean }
  //   Required with mode:"subscription". When trial:true + start_on is set,
  //   LP tokenizes the card without charging and creates the subscription
  //   with nextPaymentOn = start_on. Session returns status:"trial_started".
  // - installments: { count: N, frequency: "monthly"|... }
  //   Required with mode:"installments".
  // - metadata: LP confirmed the checkout_sessions schema fix has shipped
  //   (May 5 2026); safe to include again.
  const allowedFields = [
    'amount', 'description', 'success_url', 'cancel_url',
    'customer_email', 'customer_name', 'payment_methods',
    'expires_in', 'mode', 'recurring', 'installments', 'metadata',
  ];

  for (const field of allowedFields) {
    if (data[field] !== undefined && data[field] !== null) {
      body[field] = data[field];
    }
  }

  return lpFetch('/api/v1/checkout/sessions', {
    method: 'POST',
    body,
    key: secretKey,
  });
}

export function getCheckoutSession(secretKey: string, sessionId: string) {
  return lpFetch(`/api/v1/checkout/sessions/${sessionId}`, { key: secretKey });
}

/**
 * Best-effort merchant product create. LunarPay dashboard supports products; the public
 * REST shape may vary — we try common fields and return a string id when accepted.
 */
export async function tryCreateLunarPayProduct(
  secretKey: string,
  payload: { name: string; description?: string | null; priceCents: number; recurrence?: string },
): Promise<string | null> {
  const body: Record<string, unknown> = {
    name: payload.name,
    description: payload.description || undefined,
    amount: payload.priceCents,
    price: payload.priceCents,
    recurrence: payload.recurrence ?? 'one_time',
  };
  try {
    const res = await fetch(`${LP_BASE_URL}/api/v1/products`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: number | string; product_id?: number | string };
    const id = data.id ?? data.product_id;
    return id != null ? String(id) : null;
  } catch {
    return null;
  }
}

// ── Agency webhook management ───────────────────────────────────────

export function getAgencyWebhook() {
  return lpFetch('/api/v1/agency/webhook', { key: LP_AGENCY_KEY });
}

export function setAgencyWebhook(webhookUrl: string) {
  return lpFetch('/api/v1/agency/webhook', {
    method: 'PUT',
    body: { webhookUrl },
    key: LP_AGENCY_KEY,
  });
}

export function deleteAgencyWebhook() {
  return lpFetch('/api/v1/agency/webhook', { method: 'DELETE', key: LP_AGENCY_KEY });
}
