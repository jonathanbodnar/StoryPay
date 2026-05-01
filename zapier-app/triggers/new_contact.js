const subscribeHook = (z, bundle) =>
  z
    .request({
      url: '{{process.env.API_BASE}}/api/v1/webhooks',
      method: 'POST',
      body: { event: 'contact.created', target_url: bundle.targetUrl, source: 'zapier' },
    })
    .then((r) => r.data.subscription);

const unsubscribeHook = (z, bundle) =>
  z.request({
    url: `{{process.env.API_BASE}}/api/v1/webhooks/${bundle.subscribeData.id}`,
    method: 'DELETE',
  });

const handleHook = (z, bundle) => {
  const c = bundle.cleanedRequest?.data?.contact || bundle.cleanedRequest?.contact || {};
  return [{ ...c, id: c.id || bundle.cleanedRequest.id }];
};

const performList = (z) =>
  z.request({ url: '{{process.env.API_BASE}}/api/v1/contacts/recent?limit=20' })
    .then((r) => r.data.contacts || []);

module.exports = {
  key: 'new_contact',
  noun: 'Contact',
  display: {
    label: 'New Contact',
    description: 'Triggers when a new contact is created in StoryVenue.',
  },
  operation: {
    type: 'hook',
    perform: handleHook,
    performList,
    performSubscribe: subscribeHook,
    performUnsubscribe: unsubscribeHook,
    sample: {
      id: '00000000-0000-0000-0000-000000000000',
      email: 'couple@example.com',
      first_name: 'Avery',
      last_name: 'Smith',
      full_name: 'Avery Smith',
      phone: '+15555550100',
      wedding_date: '2027-06-12',
      guest_count: 120,
      pipeline_stage: 'inquiry',
      tags: [],
      created_at: '2026-05-01T18:00:00Z',
    },
  },
};
