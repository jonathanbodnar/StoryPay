const QB_CLIENT_ID = process.env.QUICKBOOKS_CLIENT_ID || '';
const QB_CLIENT_SECRET = process.env.QUICKBOOKS_CLIENT_SECRET || '';
const QB_REDIRECT_URI = process.env.QUICKBOOKS_REDIRECT_URI || '';
const QB_BASE_URL = process.env.QUICKBOOKS_SANDBOX === 'true'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

const FB_CLIENT_ID = process.env.FRESHBOOKS_CLIENT_ID || '';
const FB_CLIENT_SECRET = process.env.FRESHBOOKS_CLIENT_SECRET || '';
const FB_REDIRECT_URI = process.env.FRESHBOOKS_REDIRECT_URI || '';

export function getQuickBooksAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: QB_CLIENT_ID,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: QB_REDIRECT_URI,
    state,
  });
  return `https://appcenter.intuit.com/connect/oauth2?${params}`;
}

export function getFreshBooksAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: FB_CLIENT_ID,
    response_type: 'code',
    redirect_uri: FB_REDIRECT_URI,
    scope: 'user:profile:read user:invoices:read user:invoices:write',
    state,
  });
  return `https://auth.freshbooks.com/oauth/authorize?${params}`;
}

export async function exchangeQuickBooksCode(code: string) {
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: QB_REDIRECT_URI,
    }),
  });
  return res.json();
}

export async function refreshQuickBooksToken(refreshToken: string) {
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  return res.json();
}

export async function exchangeFreshBooksCode(code: string) {
  const res = await fetch('https://api.freshbooks.com/auth/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: FB_CLIENT_ID,
      client_secret: FB_CLIENT_SECRET,
      code,
      redirect_uri: FB_REDIRECT_URI,
    }),
  });
  return res.json();
}

export async function refreshFreshBooksToken(refreshToken: string) {
  const res = await fetch('https://api.freshbooks.com/auth/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: FB_CLIENT_ID,
      client_secret: FB_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  return res.json();
}

interface TransactionData {
  id: string;
  customer_name: string;
  customer_email: string;
  amount: number;
  description: string;
  date: string;
}

export async function createQuickBooksInvoice(
  accessToken: string,
  realmId: string,
  txn: TransactionData
) {
  const res = await fetch(`${QB_BASE_URL}/v3/company/${realmId}/invoice?minorversion=73`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      Line: [{
        Amount: txn.amount / 100,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: { value: '1', name: 'Services' },
        },
        Description: txn.description,
      }],
      CustomerRef: { value: '1', name: txn.customer_name },
      DocNumber: txn.id.slice(0, 20),
      TxnDate: txn.date.slice(0, 10),
      PrivateNote: `Synced from StoryPay - ${txn.id}`,
    }),
  });
  return res.json();
}

export async function createQuickBooksSalesReceipt(
  accessToken: string,
  realmId: string,
  txn: TransactionData
) {
  const res = await fetch(`${QB_BASE_URL}/v3/company/${realmId}/salesreceipt?minorversion=73`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      Line: [{
        Amount: txn.amount / 100,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: { value: '1', name: 'Services' },
        },
        Description: txn.description,
      }],
      CustomerRef: { value: '1', name: txn.customer_name },
      TxnDate: txn.date.slice(0, 10),
      PrivateNote: `Synced from StoryPay - ${txn.id}`,
    }),
  });
  return res.json();
}

export async function createFreshBooksInvoice(
  accessToken: string,
  accountId: string,
  txn: TransactionData
) {
  const res = await fetch(`https://api.freshbooks.com/accounting/account/${accountId}/invoices/invoices`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      invoice: {
        create_date: txn.date.slice(0, 10),
        lines: [{
          name: txn.customer_name,
          description: txn.description,
          qty: 1,
          unit_cost: {
            amount: (txn.amount / 100).toFixed(2),
            code: 'USD',
          },
        }],
        notes: `Synced from StoryPay - ${txn.id}`,
      },
    }),
  });
  return res.json();
}

export function isConfigured(provider: 'quickbooks' | 'freshbooks') {
  if (provider === 'quickbooks') return !!(QB_CLIENT_ID && QB_CLIENT_SECRET && QB_REDIRECT_URI);
  return !!(FB_CLIENT_ID && FB_CLIENT_SECRET && FB_REDIRECT_URI);
}
