const perform = (z, bundle) =>
  z
    .request({
      url: '{{process.env.API_BASE}}/api/v1/sms/send',
      method: 'POST',
      body: bundle.inputData,
    })
    .then((r) => r.data);

module.exports = {
  key: 'send_sms',
  noun: 'SMS',
  display: {
    label: 'Send SMS',
    description: 'Send a text message via the venue\'s connected SMS integration.',
  },
  operation: {
    perform,
    inputFields: [
      { key: 'to', label: 'Recipient phone', required: true, helpText: 'E.164 format, e.g. +15555550100.' },
      { key: 'message', label: 'Message', required: true, type: 'text' },
      { key: 'first_name', label: 'First name (optional, for new contacts)', required: false },
      { key: 'last_name', label: 'Last name (optional, for new contacts)', required: false },
      { key: 'email', label: 'Email (optional, for new contacts)', required: false },
    ],
    sample: { success: true, contact_id: 'ghl_contact_xxx' },
  },
};
