// "New Lead" — instant trigger via REST Hook with polling fallback.

const subscribeHook = (z, bundle) =>
  z
    .request({
      url: '{{process.env.API_BASE}}/api/v1/webhooks',
      method: 'POST',
      body: { event: 'lead.created', target_url: bundle.targetUrl, source: 'zapier' },
    })
    .then((res) => res.data.subscription);

const unsubscribeHook = (z, bundle) =>
  z.request({
    url: `{{process.env.API_BASE}}/api/v1/webhooks/${bundle.subscribeData.id}`,
    method: 'DELETE',
  });

// Receive the live event POST from StoryVenue and turn the payload's `data.lead`
// into a list of one item, which is the standard Zapier REST-Hook shape.
const handleHook = (z, bundle) => {
  const evt = bundle.cleanedRequest;
  const lead = evt?.data?.lead || evt?.lead || {};
  return [{ ...lead, id: lead.id || evt.id }];
};

// Polling fallback — Zapier uses this for "Test trigger" and as a safety net.
const performList = (z) =>
  z
    .request({ url: '{{process.env.API_BASE}}/api/v1/leads/recent?limit=20' })
    .then((res) => res.data.leads || []);

module.exports = {
  key: 'new_lead',
  noun: 'Lead',
  display: {
    label: 'New Lead',
    description: 'Triggers when a new lead is created in StoryVenue.',
  },
  operation: {
    type: 'hook',
    perform: handleHook,
    performList,
    performSubscribe: subscribeHook,
    performUnsubscribe: unsubscribeHook,
    sample: {
      id: '00000000-0000-0000-0000-000000000000',
      first_name: 'Avery',
      last_name: 'Smith',
      full_name: 'Avery Smith',
      email: 'avery@example.com',
      phone: '+15555550100',
      wedding_date: '2027-06-12',
      guest_count: 120,
      booking_timeline: '6-12 months',
      message: 'Looking for a barn venue for June 2027.',
      status: 'new',
      source: 'directory',
      created_at: '2026-05-01T18:00:00Z',
    },
    outputFields: [
      { key: 'id', label: 'Lead ID' },
      { key: 'first_name', label: 'First name' },
      { key: 'last_name', label: 'Last name' },
      { key: 'full_name', label: 'Full name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'wedding_date', label: 'Wedding date', type: 'datetime' },
      { key: 'guest_count', label: 'Guest count', type: 'integer' },
      { key: 'booking_timeline', label: 'Booking timeline' },
      { key: 'message', label: 'Message' },
      { key: 'status', label: 'Status' },
      { key: 'source', label: 'Source' },
      { key: 'created_at', label: 'Created at', type: 'datetime' },
    ],
  },
};
