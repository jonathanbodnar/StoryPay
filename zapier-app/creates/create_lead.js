const perform = (z, bundle) =>
  z
    .request({
      url: '{{process.env.API_BASE}}/api/v1/leads',
      method: 'POST',
      body: bundle.inputData,
    })
    .then((r) => r.data.lead);

module.exports = {
  key: 'create_lead',
  noun: 'Lead',
  display: {
    label: 'Create Lead',
    description: 'Create a new lead in StoryVenue (also mirrored into Contacts).',
  },
  operation: {
    perform,
    inputFields: [
      { key: 'email', label: 'Email', required: true },
      { key: 'first_name', label: 'First name', required: false },
      { key: 'last_name', label: 'Last name', required: false },
      { key: 'phone', label: 'Phone', required: false, helpText: 'In E.164 format (+1...).' },
      { key: 'wedding_date', label: 'Wedding date', required: false, type: 'datetime' },
      { key: 'guest_count', label: 'Guest count', required: false, type: 'integer' },
      { key: 'booking_timeline', label: 'Booking timeline', required: false },
      { key: 'message', label: 'Message', required: false, type: 'text' },
      { key: 'notes', label: 'Notes (internal)', required: false, type: 'text' },
      {
        key: 'source',
        label: 'Source',
        required: false,
        helpText: 'Optional label such as "Instagram", "Referral", etc. Defaults to "api".',
      },
    ],
    sample: {
      id: '00000000-0000-0000-0000-000000000000',
      email: 'couple@example.com',
      full_name: 'Avery Smith',
      status: 'new',
      source: 'api',
    },
  },
};
