const perform = (z, bundle) =>
  z
    .request({
      url: '{{process.env.API_BASE}}/api/v1/contacts',
      params: { email: bundle.inputData.email, limit: 1 },
    })
    .then((r) => r.data.contacts || []);

module.exports = {
  key: 'find_contact',
  noun: 'Contact',
  display: {
    label: 'Find Contact by Email',
    description: 'Look up a contact by email. Pair this with "Create or Update Contact" for upserts.',
  },
  operation: {
    perform,
    inputFields: [{ key: 'email', label: 'Email', required: true }],
    sample: {
      id: '00000000-0000-0000-0000-000000000000',
      email: 'couple@example.com',
      first_name: 'Avery',
      last_name: 'Smith',
      full_name: 'Avery Smith',
    },
  },
};
