const LUNARPAY_API_URL = process.env.LUNARPAY_API_URL || 'https://app.lunarpay.com';

interface LunarPayRequestOptions {
  method?: string;
  body?: Record<string, unknown>;
  secretKey: string;
}

export async function lunarpayRequest(
  path: string,
  { method = 'GET', body, secretKey }: LunarPayRequestOptions
) {
  const res = await fetch(`${LUNARPAY_API_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${secretKey}`,
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

export async function lunarpayPublishableRequest(
  path: string,
  { method = 'POST', body, publishableKey }: { method?: string; body?: Record<string, unknown>; publishableKey: string }
) {
  const res = await fetch(`${LUNARPAY_API_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${publishableKey}`,
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

export function getOnboardingStatus(secretKey: string) {
  return lunarpayRequest('/api/v1/onboarding/status', { secretKey });
}

export function createCustomer(secretKey: string, data: Record<string, unknown>) {
  return lunarpayRequest('/api/v1/customers', { method: 'POST', body: data, secretKey });
}

export function listCustomers(secretKey: string, search?: string, page = 1, limit = 20) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set('search', search);
  return lunarpayRequest(`/api/v1/customers?${params}`, { secretKey });
}

export function updateCustomer(secretKey: string, id: number, data: Record<string, unknown>) {
  return lunarpayRequest(`/api/v1/customers/${id}`, { method: 'PUT', body: data, secretKey });
}

export function createIntention(publishableKey: string) {
  return lunarpayPublishableRequest('/api/v1/intentions', {
    body: { hasRecurring: true },
    publishableKey,
  });
}

export function savePaymentMethod(secretKey: string, customerId: number, ticketId: string, nameHolder: string) {
  return lunarpayRequest(`/api/v1/customers/${customerId}/payment-methods`, {
    method: 'POST',
    body: { ticketId, nameHolder, setDefault: true },
    secretKey,
  });
}

export function listPaymentMethods(secretKey: string, customerId: number) {
  return lunarpayRequest(`/api/v1/customers/${customerId}/payment-methods`, { secretKey });
}

export function deletePaymentMethod(secretKey: string, customerId: number, pmId: number) {
  return lunarpayRequest(`/api/v1/customers/${customerId}/payment-methods/${pmId}`, {
    method: 'DELETE',
    secretKey,
  });
}

export function createCharge(secretKey: string, data: { customerId: number; paymentMethodId: number; amount: number; description: string }) {
  return lunarpayRequest('/api/v1/charges', { method: 'POST', body: data as unknown as Record<string, unknown>, secretKey });
}

export function createPaymentSchedule(secretKey: string, data: Record<string, unknown>) {
  return lunarpayRequest('/api/v1/payment-schedules', { method: 'POST', body: data, secretKey });
}

export function getPaymentSchedule(secretKey: string, id: number) {
  return lunarpayRequest(`/api/v1/payment-schedules/${id}`, { secretKey });
}

export function listPaymentSchedules(secretKey: string) {
  return lunarpayRequest('/api/v1/payment-schedules', { secretKey });
}

export function createSubscription(secretKey: string, data: Record<string, unknown>) {
  return lunarpayRequest('/api/v1/subscriptions', { method: 'POST', body: data, secretKey });
}

export function getSubscription(secretKey: string, id: number) {
  return lunarpayRequest(`/api/v1/subscriptions/${id}`, { secretKey });
}

export function refundCharge(secretKey: string, chargeId: number) {
  return lunarpayRequest(`/api/v1/charges/${chargeId}/refund`, { method: 'POST', secretKey });
}
