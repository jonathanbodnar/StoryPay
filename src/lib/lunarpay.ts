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
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

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
    console.error('[lpFetch] LunarPay error', {
      url,
      method,
      status: res.status,
      keyPrefix,
      requestBody: safeBody,
      responseText: errorText.slice(0, 500),
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

export function createCustomer(secretKey: string, data: Record<string, unknown>) {
  return lpFetch('/api/v1/customers', { method: 'POST', body: data, key: secretKey });
}

export function listCustomers(secretKey: string, search?: string, page = 1, limit = 20) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set('search', search);
  return lpFetch(`/api/v1/customers?${params}`, { key: secretKey });
}

export function updateCustomer(secretKey: string, id: number, data: Record<string, unknown>) {
  return lpFetch(`/api/v1/customers/${id}`, { method: 'PUT', body: data, key: secretKey });
}

export function createIntention(publishableKey: string, amount?: number) {
  const body: Record<string, unknown> = { hasRecurring: true };
  if (amount) body.amount = amount;
  return lpFetch('/api/v1/intentions', {
    method: 'POST',
    body,
    key: publishableKey,
  });
}

export function savePaymentMethod(secretKey: string, customerId: number, ticketId: string, nameHolder: string) {
  return lpFetch(`/api/v1/customers/${customerId}/payment-methods`, {
    method: 'POST',
    body: { ticketId, nameHolder, setDefault: true },
    key: secretKey,
  });
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
  // - recurring: { frequency: "weekly"|"monthly"|... , start_date?: "YYYY-MM-DD" }
  //   Required with mode:"subscription".
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
