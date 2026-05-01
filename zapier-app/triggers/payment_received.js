const subscribeHook = (z, bundle) =>
  z
    .request({
      url: '{{process.env.API_BASE}}/api/v1/webhooks',
      method: 'POST',
      body: { event: 'payment.received', target_url: bundle.targetUrl, source: 'zapier' },
    })
    .then((r) => r.data.subscription);

const unsubscribeHook = (z, bundle) =>
  z.request({
    url: `{{process.env.API_BASE}}/api/v1/webhooks/${bundle.subscribeData.id}`,
    method: 'DELETE',
  });

const handleHook = (z, bundle) => {
  const p = bundle.cleanedRequest?.data?.payment || bundle.cleanedRequest?.payment || {};
  return [{ ...p, id: p.id || `pay_${p.proposal_id || ''}_${p.paid_at || ''}` }];
};

const performList = (z) =>
  z.request({ url: '{{process.env.API_BASE}}/api/v1/payments/recent?limit=20' })
    .then((r) => r.data.payments || []);

module.exports = {
  key: 'payment_received',
  noun: 'Payment',
  display: {
    label: 'Payment Received',
    description: 'Triggers when a customer payment is captured (deposit, full payment, or installment).',
  },
  operation: {
    type: 'hook',
    perform: handleHook,
    performList,
    performSubscribe: subscribeHook,
    performUnsubscribe: unsubscribeHook,
    sample: {
      id: 'pay_xxx',
      proposal_id: '00000000-0000-0000-0000-000000000000',
      customer_name: 'Avery & Jordan',
      customer_email: 'couple@example.com',
      amount_cents: 250000,
      amount_dollars: '2500.00',
      payment_type: 'full',
      transaction_id: 'txn_abc',
      paid_at: '2026-05-01T18:00:00Z',
    },
  },
};
