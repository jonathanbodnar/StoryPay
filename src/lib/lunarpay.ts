const LP_BASE_URL = process.env.LP_BASE_URL || 'https://app.lunarpay.com';
const LP_AGENCY_KEY = process.env.LP_AGENCY_KEY || '';

interface LPRequestOptions {
  method?: string;
  body?: Record<string, unknown>;
  key: string;
}

async function lpFetch(path: string, { method = 'GET', body, key }: LPRequestOptions) {
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

export function createIntention(publishableKey: string) {
  return lpFetch('/api/v1/intentions', {
    method: 'POST',
    body: { hasRecurring: true },
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
