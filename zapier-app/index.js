// StoryVenue Zapier app — entrypoint.
// Run `zapier push` from this directory after `zapier login`.
// All API calls go to process.env.API_BASE (set in zapier env to
// https://app.storyvenue.com — or a staging URL while testing).

const authentication = require('./authentication');
const { includeBearer, handleErrors } = require('./middleware');

// Triggers
const newLead = require('./triggers/new_lead');
const newContact = require('./triggers/new_contact');
const proposalSigned = require('./triggers/proposal_signed');
const paymentReceived = require('./triggers/payment_received');
const appointmentBooked = require('./triggers/appointment_booked');
const tagAdded = require('./triggers/tag_added');

// Hidden helper trigger — populates the tag dropdown in the "Add Tag" action
const listTagsTrigger = {
  key: 'list_tags',
  noun: 'Tag',
  display: { label: 'List Tags', description: 'Internal — populates the tag dropdown.', hidden: true },
  operation: {
    perform: (z) =>
      z.request({ url: '{{process.env.API_BASE}}/api/v1/tags' }).then((r) => r.data.tags || []),
    sample: { id: 'tag_1', name: 'VIP' },
  },
};

// Actions (Creates)
const createContact = require('./creates/create_contact');
const createLead = require('./creates/create_lead');
const addTag = require('./creates/add_tag');
const sendSms = require('./creates/send_sms');
const sendEmail = require('./creates/send_email');

// Searches
const findContact = require('./searches/find_contact');

const { version } = require('./package.json');
const { version: platformVersion } = require('zapier-platform-core/package.json');

module.exports = {
  version,
  platformVersion,

  authentication,

  beforeRequest: [includeBearer],
  afterResponse: [handleErrors],

  triggers: {
    [newLead.key]: newLead,
    [newContact.key]: newContact,
    [proposalSigned.key]: proposalSigned,
    [paymentReceived.key]: paymentReceived,
    [appointmentBooked.key]: appointmentBooked,
    [tagAdded.key]: tagAdded,
    [listTagsTrigger.key]: listTagsTrigger,
  },

  creates: {
    [createContact.key]: createContact,
    [createLead.key]: createLead,
    [addTag.key]: addTag,
    [sendSms.key]: sendSms,
    [sendEmail.key]: sendEmail,
  },

  searches: {
    [findContact.key]: findContact,
  },
};
