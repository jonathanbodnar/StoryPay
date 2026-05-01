// Custom auth — venue pastes an `sv_live_...` API key generated in the
// StoryVenue dashboard (Settings → Integrations).

const test = (z, bundle) =>
  z.request({ url: '{{process.env.API_BASE}}/api/v1/me' });

module.exports = {
  type: 'custom',
  test,
  fields: [
    {
      key: 'apiKey',
      label: 'API Key',
      required: true,
      type: 'password',
      helpText:
        'Generate a key in StoryVenue → Settings → Integrations and paste the full `sv_live_…` value here.',
    },
  ],
  // Display label on the connection (shows the venue name)
  connectionLabel: (z, bundle) => bundle.inputData?.venue?.name || 'StoryVenue',
};
