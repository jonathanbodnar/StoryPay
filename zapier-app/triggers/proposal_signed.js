const subscribeHook = (z, bundle) =>
  z
    .request({
      url: '{{process.env.API_BASE}}/api/v1/webhooks',
      method: 'POST',
      body: { event: 'proposal.signed', target_url: bundle.targetUrl, source: 'zapier' },
    })
    .then((r) => r.data.subscription);

const unsubscribeHook = (z, bundle) =>
  z.request({
    url: `{{process.env.API_BASE}}/api/v1/webhooks/${bundle.subscribeData.id}`,
    method: 'DELETE',
  });

const handleHook = (z, bundle) => {
  const p = bundle.cleanedRequest?.data?.proposal || bundle.cleanedRequest?.proposal || {};
  return [{ ...p, id: p.id || bundle.cleanedRequest.id }];
};

const performList = (z) =>
  z.request({ url: '{{process.env.API_BASE}}/api/v1/proposals/recent?status=signed&limit=20' })
    .then((r) => r.data.proposals || []);

module.exports = {
  key: 'proposal_signed',
  noun: 'Proposal',
  display: {
    label: 'Proposal Signed',
    description: 'Triggers when a customer e-signs a proposal.',
  },
  operation: {
    type: 'hook',
    perform: handleHook,
    performList,
    performSubscribe: subscribeHook,
    performUnsubscribe: unsubscribeHook,
    sample: {
      id: '00000000-0000-0000-0000-000000000000',
      customer_name: 'Avery & Jordan',
      customer_email: 'couple@example.com',
      customer_phone: '+15555550100',
      price_cents: 850000,
      price_dollars: '8500.00',
      payment_type: 'full',
      signed_at: '2026-05-01T18:00:00Z',
    },
  },
};
