const perform = (z, bundle) =>
  z
    .request({
      url: '{{process.env.API_BASE}}/api/v1/contacts',
      method: 'POST',
      body: bundle.inputData,
    })
    .then((r) => r.data.contact);

module.exports = {
  key: 'create_contact',
  noun: 'Contact',
  display: {
    label: 'Create or Update Contact',
    description: 'Create a contact in StoryVenue, or update one if the email already exists.',
  },
  operation: {
    perform,
    inputFields: [
      { key: 'email', label: 'Email', required: true, type: 'string' },
      { key: 'first_name', label: 'First name', required: false },
      { key: 'last_name', label: 'Last name', required: false },
      { key: 'phone', label: 'Phone', required: false, helpText: 'In E.164 format (+1...).' },
      { key: 'partner_first_name', label: 'Partner first name', required: false },
      { key: 'partner_last_name', label: 'Partner last name', required: false },
      { key: 'partner_email', label: 'Partner email', required: false },
      { key: 'partner_phone', label: 'Partner phone', required: false },
      { key: 'wedding_date', label: 'Wedding date', required: false, type: 'datetime' },
      { key: 'guest_count', label: 'Guest count', required: false, type: 'integer' },
    ],
    sample: {
      id: '00000000-0000-0000-0000-000000000000',
      email: 'couple@example.com',
      first_name: 'Avery',
      last_name: 'Smith',
      full_name: 'Avery Smith',
      pipeline_stage: 'inquiry',
    },
  },
};
