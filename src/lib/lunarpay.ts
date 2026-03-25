const LP_BASE_URL = process.env.LP_BASE_URL || 'https://app.lunarpay.com';
const LP_AGENCY_KEY = process.env.LP_AGENCY_KEY || '';

interface LPRequestOptions {
  method?: string;
  body?: Record<string, unknown>;
  key: string;
}

export async function lpFetch(path: string, { method = 'GET', body, key }: LPRequestOptions) {
  const res = await fetch(`${LP_BASE_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errorText = await res.text();
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

export function getPaymentSchedule(secretKey: string, id: number) {
  return lpFetch(`/api/v1/payment-schedules/${id}`, { key: secretKey });
}

export function listPaymentSchedules(secretKey: string) {
  return lpFetch('/api/v1/payment-schedules', { key: secretKey });
}

export function createSubscription(secretKey: string, data: Record<string, unknown>) {
  return lpFetch('/api/v1/subscriptions', { method: 'POST', body: data, key: secretKey });
}

export function getSubscription(secretKey: string, id: number) {
  return lpFetch(`/api/v1/subscriptions/${id}`, { key: secretKey });
}

export function refundCharge(secretKey: string, chargeId: number) {
  return lpFetch(`/api/v1/charges/${chargeId}/refund`, { method: 'POST', key: secretKey });
}

// ── Checkout Sessions ────────────────────────────────────────────────

export function createCheckoutSession(
  secretKey: string,
  data: {
    amount: number;
    description: string;
    success_url: string;
    cancel_url?: string;
    customer_email?: string;
    customer_name?: string;
    metadata?: Record<string, string>;
  }
) {
  const body: Record<string, unknown> = {
    amount: data.amount,
    description: data.description,
    success_url: data.success_url,
  };
  if (data.cancel_url) body.cancel_url = data.cancel_url;
  if (data.customer_email) body.customer_email = data.customer_email;
  if (data.customer_name) body.customer_name = data.customer_name;
  if (data.metadata) body.metadata = data.metadata;

  return lpFetch('/api/v1/checkout/sessions', {
    method: 'POST',
    body,
    key: secretKey,
  });
}

export function getCheckoutSession(secretKey: string, sessionId: string) {
  return lpFetch(`/api/v1/checkout/sessions/${sessionId}`, { key: secretKey });
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
