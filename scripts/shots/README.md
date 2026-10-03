# The screenshot kit

Product photography for landing pages: real screens of the app, shot on the
test copy with the showcase venue's polished fake data, then drawn into device
frames (browser window, laptop, tablet, phone). Nothing here touches the live
site or real people.

```
railway run --service "StoryVenue Backend" --environment Dev -- node scripts/shots/seed-showcase.mjs   # once, or to refresh the data
railway run --service "StoryVenue Backend" --environment Dev -- node scripts/shots/capture.mjs         # shoot every screen
node scripts/shots/frame.mjs                                                                           # draw the device frames
```

- **seed-showcase.mjs** builds **Willow Creek Estate** on the test copy: a
  full lead pipeline, a lively inbox, a month of calendar, eight months of
  payment history, an active payment plan, a sent proposal
  (`/proposal/showcase-proposal-token-0001`) and a published listing
  (`/venue/willow-creek-estate`). Rerunnable; it wipes and rebuilds its own
  venue only. Owner sign-in: `showcase-owner@example.com` + `STAGING_PASSWORD`.
- **pages.mjs** lists what gets shot and on which screen sizes. Add a screen
  there; the fast checks (`tests/unit/shots.test.ts`) confirm every listed
  page still exists.
- **capture.mjs** signs in once and shoots each screen at retina sharpness
  into `shots-out/raw` (pass shot names to reshoot a few). Long public pages
  also get a `--full` full-length capture for hero crops.
- **frame.mjs** writes `shots-out/framed/*.png` (transparent, shadowed) and
  `.webp`, choosing the frame per device; the phone gets a drawn status bar
  and dynamic island, so phone shots read as the mobile app.

`shots-out/` is not committed. When a landing page needs imagery, copy the
framed files it uses into that page's `public/` assets.
