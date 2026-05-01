# StoryVenue — Zapier Integration

Private/unlisted Zapier integration for the StoryVenue platform.

This app calls the StoryVenue public REST API (`/api/v1/*`) using a per-venue
API key generated in **Settings → Integrations**.

## What's inside

```
zapier-app/
  authentication.js       # API-key auth, ping /api/v1/me on connect
  middleware.js           # Adds `Authorization: Bearer …`, friendly error msgs
  index.js                # Wires up triggers / creates / searches
  triggers/
    new_lead.js           # Instant + polling — lead.created
    new_contact.js        # Instant + polling — contact.created
    proposal_signed.js    # Instant + polling — proposal.signed
    payment_received.js   # Instant + polling — payment.received
    appointment_booked.js # Instant + polling — appointment.booked
    tag_added.js          # Instant — tag.added
  creates/
    create_contact.js     # POST /api/v1/contacts
    create_lead.js        # POST /api/v1/leads
    add_tag.js            # POST /api/v1/tags/apply  (fires Workflows!)
    send_sms.js           # POST /api/v1/sms/send
    send_email.js         # POST /api/v1/email/send
  searches/
    find_contact.js       # GET  /api/v1/contacts?email=…
```

## First-time setup (per-environment)

```bash
cd zapier-app
npm install

# Authenticate with the Zapier CLI
npx zapier login

# One-time: register the private app (do this once per environment)
npx zapier register "StoryVenue (private)"

# Set the API base URL for this version (production vs staging)
npx zapier env:set 1.0.0 API_BASE=https://app.storyvenue.com

# Push the code to Zapier
npx zapier push
```

After `push`, share the private invite link with venues:

```bash
npx zapier users:add user@example.com 1.0.0
# or (for the public invite link):
npx zapier promote 1.0.0 --reason="Private launch"
```

Once a Zapier user accepts the invite, they'll see "StoryVenue" in the app
list and can create Zaps using any of the triggers / actions above.

## Local testing

```bash
# Generates `.env` you can use for local invokes
npx zapier env:get 1.0.0

# Test a specific trigger or create against the live API
API_BASE=https://app.storyvenue.com \
  npx zapier invoke trigger new_lead --inputData '{}'
```

## Promoting to a new version

When the public API changes, bump `package.json` version, run:

```bash
npx zapier push
npx zapier migrate 1.0.0 1.1.0 100   # migrate 100% of existing Zaps
```

## Security notes

- The API key is stored in Zapier's encrypted credential store. The user can
  rotate it any time by generating a new key in StoryVenue and updating the
  Zapier connection.
- All requests go over HTTPS to `app.storyvenue.com`.
- Webhook subscriptions auto-disable after 5 consecutive delivery failures
  (the venue can re-enable by re-running the Zap test).
