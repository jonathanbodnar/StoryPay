const subscribeHook = (z, bundle) =>
  z
    .request({
      url: '{{process.env.API_BASE}}/api/v1/webhooks',
      method: 'POST',
      body: { event: 'tag.added', target_url: bundle.targetUrl, source: 'zapier' },
    })
    .then((r) => r.data.subscription);

const unsubscribeHook = (z, bundle) =>
  z.request({
    url: `{{process.env.API_BASE}}/api/v1/webhooks/${bundle.subscribeData.id}`,
    method: 'DELETE',
  });

const handleHook = (z, bundle) => {
  const evt = bundle.cleanedRequest?.data || bundle.cleanedRequest || {};
  return [
    {
      id: bundle.cleanedRequest.id,
      lead_id: evt.lead_id,
      email: evt.email,
      tag_id: evt.tag?.id,
      tag_name: evt.tag?.name,
      tag_system_key: evt.tag?.system_key,
    },
  ];
};

// Polling fallback: there isn't a tag-event polling endpoint, so we just
// surface a sample for "Test trigger". Production use should rely on the hook.
const performList = () =>
  Promise.resolve([
    {
      id: 'evt_sample',
      lead_id: '00000000-0000-0000-0000-000000000000',
      email: 'couple@example.com',
      tag_id: '00000000-0000-0000-0000-000000000000',
      tag_name: 'VIP',
      tag_system_key: null,
    },
  ]);

module.exports = {
  key: 'tag_added',
  noun: 'Tag',
  display: {
    label: 'Tag Added to Contact',
    description: 'Triggers when a tag is applied to a lead/contact (manual or automatic).',
  },
  operation: {
    type: 'hook',
    perform: handleHook,
    performList,
    performSubscribe: subscribeHook,
    performUnsubscribe: unsubscribeHook,
    sample: {
      id: 'evt_sample',
      lead_id: '00000000-0000-0000-0000-000000000000',
      email: 'couple@example.com',
      tag_id: '00000000-0000-0000-0000-000000000000',
      tag_name: 'VIP',
      tag_system_key: null,
    },
  },
};
