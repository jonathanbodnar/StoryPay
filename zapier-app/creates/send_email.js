const perform = (z, bundle) =>
  z
    .request({
      url: '{{process.env.API_BASE}}/api/v1/email/send',
      method: 'POST',
      body: bundle.inputData,
    })
    .then((r) => r.data);

module.exports = {
  key: 'send_email',
  noun: 'Email',
  display: {
    label: 'Send Email',
    description: 'Send a transactional email via Resend (the same engine that powers proposal/payment emails).',
  },
  operation: {
    perform,
    inputFields: [
      { key: 'to', label: 'To', required: true, type: 'string', helpText: 'Single email address.' },
      { key: 'subject', label: 'Subject', required: true },
      { key: 'body_html', label: 'HTML body', required: false, type: 'text', helpText: 'Use either HTML body or plain-text body.' },
      { key: 'body_text', label: 'Plain-text body', required: false, type: 'text' },
      { key: 'from_name', label: 'From name', required: false, helpText: 'Defaults to your venue name.' },
      { key: 'reply_to', label: 'Reply-to', required: false },
      { key: 'cc', label: 'Cc', required: false, list: true },
      { key: 'bcc', label: 'Bcc', required: false, list: true },
    ],
    sample: { success: true },
  },
};
