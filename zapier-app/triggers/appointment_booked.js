const subscribeHook = (z, bundle) =>
  z
    .request({
      url: '{{process.env.API_BASE}}/api/v1/webhooks',
      method: 'POST',
      body: { event: 'appointment.booked', target_url: bundle.targetUrl, source: 'zapier' },
    })
    .then((r) => r.data.subscription);

const unsubscribeHook = (z, bundle) =>
  z.request({
    url: `{{process.env.API_BASE}}/api/v1/webhooks/${bundle.subscribeData.id}`,
    method: 'DELETE',
  });

const handleHook = (z, bundle) => {
  const a = bundle.cleanedRequest?.data?.appointment || bundle.cleanedRequest?.appointment || {};
  return [{ ...a, id: a.id || bundle.cleanedRequest.id }];
};

const performList = (z) =>
  z.request({ url: '{{process.env.API_BASE}}/api/v1/appointments/recent?limit=20' })
    .then((r) => r.data.appointments || []);

module.exports = {
  key: 'appointment_booked',
  noun: 'Appointment',
  display: {
    label: 'Appointment Booked',
    description: 'Triggers when a new appointment / tour / call is booked on the calendar.',
  },
  operation: {
    type: 'hook',
    perform: handleHook,
    performList,
    performSubscribe: subscribeHook,
    performUnsubscribe: unsubscribeHook,
    sample: {
      id: '00000000-0000-0000-0000-000000000000',
      title: 'Venue Tour — Avery & Jordan',
      event_type: 'tour',
      status: 'confirmed',
      start_at: '2026-05-15T17:00:00Z',
      end_at: '2026-05-15T18:00:00Z',
      customer_email: 'couple@example.com',
      created_at: '2026-05-01T18:00:00Z',
    },
  },
};
