#!/usr/bin/env node
/**
 * The showcase venue: "Willow Creek Estate" on the test copy, filled with
 * polished fake data that photographs well — a busy lead pipeline, a lively
 * inbox, a full calendar, proposals with months of payment history, and a
 * published listing with photos. The screenshot kit (scripts/shots) signs in
 * as its owner and shoots the product for landing-page imagery.
 *
 *   railway run --service "StoryVenue Backend" --environment Dev -- node scripts/shots/seed-showcase.mjs
 *
 * Only on the test copy, like every staging script. Safe to rerun: the
 * showcase venue's rows are wiped and rebuilt each time (fixed venue id).
 * Every person in it is fake (example.com addresses, 555-02xx numbers).
 */

import bcrypt from 'bcryptjs';
import pg from 'pg';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const LIVE_SUPABASE_REF = 'brnxhsaakmhgwcthcapd';
const hide = (s) => String(s).replace(/postgres(ql)?:\/\/\S+/g, '[connection hidden]');

export const SHOWCASE = {
  venueId: 'ca110000-0000-4000-8000-000000000001',
  name: 'Willow Creek Estate',
  slug: 'willow-creek-estate',
  ownerEmail: 'showcase-owner@example.com',
  coupleEmail: 'showcase-couple@example.com',
};
const V = SHOWCASE.venueId;
const id = (block, n) => `ca110000-0000-4000-8000-00000000${block}${String(n).padStart(2, '0')}`;

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const daysAgo = (d) => new Date(now - d * DAY).toISOString();
const daysAhead = (d) => new Date(now + d * DAY).toISOString();
/** A date `d` days out, at `hhmm` New York time (close enough for pictures). */
const at = (d, hhmm) =>
  `${new Date(now + d * DAY).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })}T${hhmm}:00-04:00`;
/** The next `n`th Saturday from today (n = 0 → the coming one). */
const saturdayOffset = (n) => ((6 - new Date(now).getUTCDay() + 7) % 7 || 7) + n * 7;

const photo = (pid, w) => `https://images.unsplash.com/${pid}?w=${w}&q=80&auto=format&fit=crop`;
const GALLERY = [
  'photo-1519167758481-83f550bb49b3', // chandeliered hall
  'photo-1464366400600-7168b8af9bc3', // ceremony barn
  'photo-1511795409834-ef04bbd61622', // reception tables
  'photo-1465495976277-4387d4b0b4c6', // garden arch
  'photo-1510076857177-7470076d4098', // grounds
  'photo-1522413452208-996ff3f3e740', // sparkler send-off
  'photo-1507504031003-b417219a0fde', // dining detail
];

// ── The pipeline (the app's default template, so the Kanban reads true) ─────
const STAGES = [
  ['Lead', '#3b82f6', 'open'], ['Conversations Started', '#0ea5e9', 'open'],
  ['Qualified', '#f59e0b', 'open'], ['Tour Booked', '#6366f1', 'open'],
  ['Proposal Sent', '#8b5cf6', 'open'], ['Wedding Booked', '#10b981', 'won'],
  ['Follow up', '#ec4899', 'open'], ['Not Interested', '#9ca3af', 'lost'],
];
const STATUS_FOR_STAGE = {
  'Lead': 'new', 'Conversations Started': 'new', 'Qualified': 'contacted', 'Tour Booked': 'tour_booked',
  'Proposal Sent': 'proposal_sent', 'Wedding Booked': 'booked_wedding', 'Follow up': 'contacted', 'Not Interested': 'not_interested',
};

// name, stage, source, wedding date, guests, value $, days ago, message
const LEADS = [
  ['Grace Caldwell', 'Lead', 'directory', '2027-09-18', 140, 11800, 0.2, 'We fell in love with the photos of the Grand Hall! Is September 18th available?'],
  ['Maya Donovan', 'Lead', 'form', '2027-06-05', 110, 9400, 1, 'Hi! We’re planning an early-June wedding and would love pricing details.'],
  ['Lena Fitzgerald', 'Lead', 'embed', '2028-05-20', 180, 12600, 2, 'Just got engaged! Looking at spring 2028 — could we set up a visit?'],
  ['Chloe Bennett', 'Conversations Started', 'directory', '2027-10-09', 125, 10200, 4, 'Your garden pavilion looks stunning. What does an October Saturday look like?'],
  ['Zoe Ramirez', 'Conversations Started', 'lead_link', '2027-08-14', 95, 8900, 6, 'A friend recommended you — can you send your pricing guide?'],
  ['Nora Castellanos', 'Qualified', 'form', '2027-07-24', 150, 11000, 9, 'We’re comparing a few venues for late July. Do you host both ceremony and reception?'],
  ['Priya Shah', 'Qualified', 'directory', '2027-11-06', 120, 9800, 12, 'Is November 6th open? Deciding between two dates this week.'],
  ['Elise Harrington', 'Tour Booked', 'embed', '2027-05-15', 160, 12400, 15, 'Confirmed for the Saturday tour — so excited to see the grounds!'],
  ['Jasmine Cole', 'Tour Booked', 'directory', '2027-06-26', 135, 10600, 18, 'Booking the tour for next week. Can my parents join?'],
  ['Camille Rousseau', 'Proposal Sent', 'form', '2027-09-04', 170, 13900, 22, 'Thank you for the walkthrough — we’d love to see a proposal.'],
  ['Hannah Kim', 'Proposal Sent', 'directory', '2027-04-17', 100, 9200, 26, 'The tour sealed it for us. Sending our details for the proposal!'],
  // Booked inside the last 30 days, so the funnel's "booked weddings" step counts them.
  ['Emma Sinclair', 'Wedding Booked', 'directory', '2027-06-12', 180, 14800, 26, 'We can’t wait! June 12th at Willow Creek — it’s really happening!'],
  ['Olivia Marsh', 'Wedding Booked', 'embed', '2027-10-02', 150, 12900, 29, 'Contract signed! Counting down to October.'],
  ['Tessa Nguyen', 'Follow up', 'lead_link', '2028-03-11', 90, 8400, 30, 'Still talking it over with family — can you hold our quote a few weeks?'],
];

// Couples the venue is actively talking to (the inbox).
// key, name, email-or-sms, hours since last message, starred, subject, [from, text][]
const THREADS = [
  ['emma', 'Emma Sinclair', 'sms', 0.4, true, 'Wedding — June 12, 2027', [
    ['owner', 'Hi Emma! Confirming your menu tasting for Thursday at 5pm — chef is doing the full spring menu for you two.'],
    ['contact', 'Perfect, we’ll be there! Quick thing — my parents just booked flights for that week.'],
    ['owner', 'Wonderful! Happy to set 2 more places at the tasting if they’d like to join.'],
    ['contact', 'That works perfectly! Could we do the tasting for 6 instead of 4? My sister is flying in too \u{1F60A}'],
  ]],
  ['camille', 'Camille Rousseau', 'email', 3, false, 'Your Willow Creek proposal', [
    ['owner', 'Hi Camille! Your proposal for September 4th is ready — everything we walked through is in there, including the garden ceremony and the extended bar package.'],
    ['contact', 'This looks beautiful! One question before we sign — does the bar package include champagne service for the toast, or is that separate?'],
    ['owner', 'It’s included! Passed champagne for every guest right before the toasts — no extra charge.'],
    ['contact', 'Amazing. We’re reviewing tonight and planning to sign this week!'],
  ]],
  ['elise', 'Elise Harrington', 'sms', 7, false, 'Tour this Saturday', [
    ['owner', 'Hi Elise! Looking forward to your tour this Saturday at 11am. Park at the main gate and we’ll meet you on the veranda.'],
    ['contact', 'Saturday at 11 works great. See you then!'],
  ]],
  ['olivia', 'Olivia Marsh', 'email', 26, false, 'Vendor logistics — October 2', [
    ['contact', 'Hi! Our photographer asked about load-in time on the day — when can vendors arrive?'],
    ['owner', 'Vendors can load in from 10am. I’ll send the full vendor sheet with power, parking and the floor plan this week.'],
    ['contact', 'You’re the best — thank you!'],
  ]],
  ['priya', 'Priya Shah', 'sms', 49, false, 'November 6 availability', [
    ['contact', 'Is November 6th still open? We’re deciding between two dates this week.'],
    ['owner', 'It is! I’ve put a courtesy hold on it for you through Friday. Want to come walk the grounds before you decide?'],
    ['contact', 'Yes please — Thursday afternoon if possible!'],
  ]],
];

// Paid weddings over the past months (the revenue history behind Reports).
// name, months ago (booking), price $, how many monthly payments made so far
const PAST_BOOKINGS = [
  ['Avery & Daniel Brooks', 8, 10400, 4, true], ['Sofia & Marcus Delgado', 7, 12800, 4, true],
  ['Ruby & Nathan Hale', 6, 9200, 4, true], ['Isla & Theo Merritt', 5, 15200, 4, true],
  ['June & Caleb Ashford', 4, 8800, 3, false], ['Margot & Eli Weston', 3, 13600, 3, false],
  ['Wren & Oscar Langley', 2, 11400, 2, false], ['Daphne & Rhys Calloway', 1, 9800, 1, false],
];

const PROPOSAL_HTML = `
<h2>Your Wedding at Willow Creek Estate</h2>
<p>Camille &amp; Julien — thank you for spending the afternoon with us. We'd be honored to host your wedding on <strong>Saturday, September 4, 2027</strong>. Here is everything we talked through, in one place.</p>
<h3>The Garden Ceremony</h3>
<p>An outdoor ceremony for 170 guests beneath the willow arbor, with garden seating, a dressed signing table, and our coordinator running the processional. The Vine Loft is yours from 10am as a private suite for getting ready.</p>
<h3>Reception in the Grand Hall</h3>
<ul>
<li>Exclusive use of the Grand Hall from ceremony to send-off (11pm)</li>
<li>Tables, Chiavari chairs, linen, china and glassware for 170</li>
<li>Plated three-course dinner by our in-house kitchen</li>
<li>Extended bar package with passed champagne for the toasts</li>
<li>Dance floor, stage, house sound and lighting</li>
<li>Day-of coordination and on-site parking team</li>
</ul>
<h3>The fine print</h3>
<p>Your date is reserved on signing with the first payment below. The balance follows the payment schedule you chose, and you can adjust guest count up to 30 days before the wedding.</p>
<p><em>We can't wait to celebrate with you.</em><br/>— Sarah Whitmore, Willow Creek Estate</p>`;

// ── The logo: drawn once, uploaded to the venue-images bucket ───────────────
async function makeLogo(supabaseUrl, serviceKey) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="240">
    <text x="380" y="118" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
      font-size="92" font-style="italic" fill="#20352a">Willow Creek</text>
    <text x="380" y="186" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
      font-size="34" letter-spacing="22" fill="#5c6f63">ESTATE</text>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const storage = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }).storage;
  const bucket = 'venue-images';
  const { data: buckets } = await storage.listBuckets();
  if (!(buckets ?? []).some((b) => b.name === bucket)) {
    await storage.createBucket(bucket, { public: true });
  }
  const path = `media/${V}/showcase-logo.png`;
  const { error } = await storage.from(bucket).upload(path, png, { contentType: 'image/png', upsert: true });
  if (error) throw new Error(`logo upload: ${error.message}`);
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

async function main() {
  const dbUrl = (process.env.SUPABASE_DB_URL || '').trim();
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const password = (process.env.STAGING_PASSWORD || '').trim();
  if (process.env.APP_ENV !== 'staging') throw new Error('Run with railway run --environment Dev (APP_ENV=staging).');
  if (!dbUrl || dbUrl.includes(LIVE_SUPABASE_REF) || supabaseUrl.includes(LIVE_SUPABASE_REF)) {
    throw new Error('The target must be the test database. Stopping.');
  }
  if (!password || !serviceKey) throw new Error('STAGING_PASSWORD and SUPABASE_SERVICE_ROLE_KEY must be set.');

  const logoUrl = await makeLogo(supabaseUrl, serviceKey);
  console.log('logo: uploaded');

  const db = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const q = (text, params) => db.query(text, params);

  // ── Wipe the showcase venue's old rows (children first) ──
  for (const t of ['conversation_messages', 'conversation_thread_reads']) {
    await q(`delete from public.${t} where thread_id in (select id from public.conversation_threads where venue_id = $1)`, [V]);
  }
  for (const t of ['conversation_threads', 'calendar_events', 'proposal_installments',
    'proposal_payments', 'proposals', 'lead_tag_assignments', 'leads', 'lead_pipeline_stages', 'lead_pipelines',
    'venue_customers', 'venue_spaces']) {
    await q(`delete from public.${t} where venue_id = $1`, [V]);
  }

  // ── The venue ──
  const plan = (await q(`select id from public.directory_plans where slug = 'bride-booking-system'`)).rows[0];
  if (!plan) throw new Error('Run scripts/staging/seed.mjs first (plans are missing).');
  await q(
    `insert into public.venues (id, name, slug, email, notification_email, brand_email, brand_phone, password_hash,
       setup_completed, onboarding_status, onboarding_completed_at, onboarding_checklist_dismissed,
       directory_plan_id, directory_subscription_status, email_verified_at,
       owner_first_name, owner_last_name, location_city, location_state, location_full, lat, lng, timezone,
       brand_color, brand_logo_url, logo_url, brand_tagline, venue_type, indoor_outdoor, capacity_min, capacity_max,
       price_min, price_max, description, features, cover_image_url, gallery_images, show_map,
       is_published, is_demo, monthly_booking_goal, a2p_verified, sms_admin_override,
       ghl_connected, ghl_location_id, ghl_access_token)
     values ($1, $2, $3, $4, $4, $4, '+18285550240', $5,
       true, 'registered', now() - interval '18 months', true,
       $6, 'active', now() - interval '18 months',
       'Sarah', 'Whitmore', 'Asheville', 'NC', '214 Willow Creek Lane, Asheville, NC 28803', 35.5329, -82.4891, 'America/New_York',
       '#2d4a3a', $7, $7, 'Where your story begins', 'estate', 'both', 50, 220,
       8500, 16000, $8, $9, $10, $11, true,
       true, false, 24000, true, true,
       true, 'staging-showcase-location', 'pit-staging-fake')
     on conflict (id) do update set
       name = excluded.name, slug = excluded.slug, email = excluded.email, notification_email = excluded.notification_email,
       brand_email = excluded.brand_email, password_hash = excluded.password_hash, brand_color = excluded.brand_color,
       brand_logo_url = excluded.brand_logo_url, logo_url = excluded.logo_url, description = excluded.description,
       features = excluded.features, cover_image_url = excluded.cover_image_url, gallery_images = excluded.gallery_images,
       directory_plan_id = excluded.directory_plan_id, directory_subscription_status = excluded.directory_subscription_status,
       monthly_booking_goal = excluded.monthly_booking_goal, is_published = true`,
    [V, SHOWCASE.name, SHOWCASE.slug, SHOWCASE.ownerEmail, await bcrypt.hash(password, 10), plan.id, logoUrl,
      'A restored 1920s estate on forty acres of gardens, willows and mountain light, twenty minutes from downtown Asheville. ' +
      'Exchange vows beneath the willow arbor, dine under the Grand Hall’s original beams, and dance until the sparkler send-off. ' +
      'One wedding per day, an in-house kitchen, and a team that has hosted over three hundred celebrations.',
      JSON.stringify(['Outdoor ceremony garden', 'In-house catering & bar', 'Bridal suite & grooms lounge',
        'Day-of coordination', 'On-site parking', 'Climate-controlled hall', 'Rain plan included', 'Pet friendly']),
      photo(GALLERY[0], 2000), JSON.stringify(GALLERY.slice(1).map((p) => photo(p, 1600)))],
  );

  // ── Spaces ──
  const SPACES = [['The Grand Hall', '#6366f1', 220], ['Garden Pavilion', '#10b981', 150], ['The Vine Loft', '#f59e0b', 60]];
  for (const [i, [name, color, cap]] of SPACES.entries()) {
    await q(`insert into public.venue_spaces (id, venue_id, name, color, capacity, active) values ($1, $2, $3, $4, $5, true)`,
      [id('f0', i + 1), V, name, color, cap]);
  }

  // ── Pipeline + stages ──
  const pipelineId = id('a0', 1);
  await q(`insert into public.lead_pipelines (id, venue_id, name, is_default, position) values ($1, $2, 'Sales Pipeline', true, 0)`, [pipelineId, V]);
  const stageId = {};
  for (const [i, [name, color, kind]] of STAGES.entries()) {
    stageId[name] = id('a1', i + 1);
    await q(`insert into public.lead_pipeline_stages (id, pipeline_id, venue_id, name, color, kind, position) values ($1, $2, $3, $4, $5, $6, $7)`,
      [stageId[name], pipelineId, V, name, color, kind, i]);
  }

  // ── Leads ──
  const positionInStage = {};
  for (const [i, [name, stage, source, wedding, guests, value, ago, message]] of LEADS.entries()) {
    const [first, ...rest] = name.split(' ');
    const pos = (positionInStage[stage] = (positionInStage[stage] ?? -1) + 1);
    await q(
      `insert into public.leads (id, venue_id, name, first_name, last_name, email, phone, source, wedding_date, guest_count,
         opportunity_value, status, message, pipeline_id, stage_id, position, created_at, updated_at,
         sms_consent, sms_consent_at, sms_consent_source, last_inbound_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17, true, $17, 'showcase_seed', $17)`,
      [id('b0', i + 1), V, name, first, rest.join(' '), `${first.toLowerCase()}.${rest.join('').toLowerCase()}@example.com`,
        `+1828555${String(200 + i).padStart(4, '0')}`, source, wedding, guests, value,
        STATUS_FOR_STAGE[stage], message, pipelineId, stageId[stage], pos, daysAgo(ago)],
    );
  }

  // ── Couples in conversation (contacts + inbox threads) ──
  for (const [i, [, name, channel, hoursAgo, starred, subject, messages]] of THREADS.entries()) {
    const [first, ...rest] = name.split(' ');
    const customerId = id('c0', i + 1);
    await q(
      `insert into public.venue_customers (id, venue_id, customer_email, first_name, last_name, phone, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [customerId, V, `${first.toLowerCase()}.${rest.join('').toLowerCase()}@example.com`, first, rest.join(' '),
        `+1828555${String(300 + i).padStart(4, '0')}`, daysAgo(20 + i * 8)],
    );
    const threadId = id('d0', i + 1);
    const last = messages[messages.length - 1];
    const lastAt = new Date(now - hoursAgo * 3600 * 1000).toISOString();
    await q(
      `insert into public.conversation_threads (id, venue_id, venue_customer_id, subject, external_reply_channel,
         is_starred, last_message_at, last_message_preview, last_message_visibility, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'external', $9)`,
      [threadId, V, customerId, subject, channel, starred, lastAt, last[1].slice(0, 140), daysAgo(12 + i * 6)],
    );
    for (const [j, [from, text]] of messages.entries()) {
      const msgAt = new Date(now - hoursAgo * 3600 * 1000 - (messages.length - 1 - j) * 5 * 3600 * 1000).toISOString();
      await q(
        `insert into public.conversation_messages (id, thread_id, visibility, channel, body, sender_kind,
           contact_from_name, external_email_sent, created_at)
         values ($1, $2, 'external', $3, $4, $5, $6, $7, $8)`,
        [id(`d${i + 1}`, j + 1), threadId, channel, text, from === 'owner' ? 'owner' : 'contact',
          from === 'contact' ? name : null, channel === 'email' && from === 'owner', msgAt],
      );
    }
  }

  // ── Calendar: weddings on Saturdays, tours and tastings in between ──
  const spaceId = (n) => id('f0', n);
  const EVENTS = [];
  const SAT_COUPLES = [['Sinclair Wedding', 1], ['Marsh Wedding', 2], ['Alvarez Wedding', 1], ['Peterson Wedding', 1]];
  for (const [i, [title, space]] of SAT_COUPLES.entries()) {
    const sat = saturdayOffset(i);
    EVENTS.push([title, 'wedding', space, sat, '15:00', '23:00']);
    if (i < 2) EVENTS.push([`Rehearsal — ${title.split(' ')[0]}`, 'rehearsal', space, sat - 1, '16:00', '17:00']);
  }
  EVENTS.push(
    ['Brooks Wedding', 'wedding', 2, saturdayOffset(0) - 7, '15:00', '23:00'],
    ['Tour — Grace Caldwell', 'tour', 1, 1, '11:00', '11:45'],
    ['Tour — Maya Donovan', 'tour', 2, 2, '15:30', '16:15'],
    ['Menu Tasting — Emma & Ryan', 'tasting', 3, 3, '17:00', '18:30'],
    ['Tour — Priya Shah', 'tour', 1, 4, '10:00', '10:45'],
    ['Tour — Chloe Bennett', 'tour', 2, 5, '13:00', '13:45'],
    ['Vendor walkthrough — Marsh wedding', 'meeting', 2, 6, '09:30', '10:30'],
    ['Florist visit — Sinclair wedding', 'meeting', 1, 8, '14:00', '15:00'],
  );
  for (const [i, [title, type, space, day, start, end]] of EVENTS.entries()) {
    await q(
      `insert into public.calendar_events (id, venue_id, space_id, title, event_type, status, start_at, end_at)
       values ($1, $2, $3, $4, $5, 'confirmed', $6, $7)`,
      [id('e9', i + 1), V, spaceId(space), title, type, at(day, start), at(day, end)],
    );
  }

  // ── Booked weddings with payment history (Reports + Transactions) ──
  let paymentN = 0;
  const ledger = async (proposalId, cents, dayAgo, methodNote) => {
    paymentN++;
    await q(
      `insert into public.proposal_payments (id, proposal_id, venue_id, amount_cents, method, source, reference, note, paid_at, created_at)
       values ($1, $2, $3, $4, 'cc', 'online', $5, $6, $7, $7)`,
      [id('91', paymentN), proposalId, V, cents, `pi_showcase_${paymentN}`, methodNote, daysAgo(dayAgo)],
    );
  };
  for (const [i, [couple, monthsAgo, priceD, paymentsMade, fullyPaid]] of PAST_BOOKINGS.entries()) {
    const pid = id('80', i + 1);
    const price = priceD * 100;
    const deposit = Math.round(price * 0.3);
    const monthly = Math.floor((price - deposit) / 7 / 100) * 100;
    const signedAgo = monthsAgo * 30;
    const first = couple.split(' ')[0].toLowerCase();
    await q(
      `insert into public.proposals (id, venue_id, customer_name, customer_email, status, price, payment_type,
         payment_provider, content, sent_at, opened_at, signed_at, paid_at, signed_price, signed_payment_type, created_at)
       values ($1, $2, $3, $4, 'paid', $5, 'installment', 'stripe', $6, $7, $7, $8, $8, $5, 'installment', $7)`,
      [pid, V, couple, `${first}.showcase@example.com`, price,
        `<h2>Your Wedding at Willow Creek Estate</h2><p>Package and schedule as walked through on your tour.</p>`,
        daysAgo(signedAgo + 4), daysAgo(signedAgo)],
    );
    await ledger(pid, deposit, signedAgo, 'Deposit at signing');
    for (let p = 1; p <= paymentsMade; p++) {
      const lastOfPlan = fullyPaid && p === paymentsMade;
      const amount = lastOfPlan ? price - deposit - monthly * (paymentsMade - 1) : monthly;
      await ledger(pid, amount, signedAgo - p * 30, `Payment ${p + 1}`);
    }
  }

  // ── Emma Sinclair: the active payment plan (the booking page's plan panel) ──
  const planPid = id('80', 20);
  const planPrice = 1480000;
  const planDeposit = 444000;
  const monthlyAmt = 207200;
  const planDates = [daysAgo(40), daysAgo(10), daysAhead(20), daysAhead(50), daysAhead(80), daysAhead(110)];
  await q(
    `insert into public.proposals (id, venue_id, customer_name, customer_email, customer_phone, status, price, payment_type,
       payment_provider, payment_config, content, sent_at, opened_at, signed_at, paid_at, signed_price, signed_payment_type, created_at)
     values ($1, $2, 'Emma Sinclair', 'emma.sinclair@example.com', '+18285550300', 'paid', $3, 'installment',
       'stripe', $4, $5, $6, $6, $7, $7, $3, 'installment', $6)`,
    [planPid, V, planPrice,
      JSON.stringify({ installments: planDates.map((d, i2) => ({ amount: i2 === 0 ? planDeposit : monthlyAmt, date: d.slice(0, 10) })) }),
      `<h2>Your Wedding at Willow Creek Estate</h2><p>Saturday, June 12, 2027 — ceremony in the garden, reception in the Grand Hall for 180 guests.</p>`,
      daysAgo(44), daysAgo(40)],
  );
  await ledger(planPid, planDeposit, 40, 'Deposit at signing');
  await ledger(planPid, monthlyAmt, 10, 'Payment 2');
  // The deposit has no installment row (the plan panel draws it from the
  // plan itself, like the real charger); rows exist for payments 2..6 only.
  for (const [i2, d] of planDates.slice(1).entries()) {
    await q(
      `insert into public.proposal_installments (id, proposal_id, venue_id, installment_number, installment_count,
         due_date, amount_cents, status, paid_at, next_attempt_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id('81', i2 + 1), planPid, V, i2 + 1, planDates.length - 1, d.slice(0, 10),
        monthlyAmt, i2 === 0 ? 'paid' : 'scheduled', i2 === 0 ? d : null, i2 === 0 ? null : d],
    );
  }

  // ── Camille Rousseau: the sent proposal (the couple-page hero shot) ──
  const sentDates = [0, 30, 60, 90, 120].map((d) => daysAhead(d).slice(0, 10));
  const sentPrice = 1390000;
  const sentDeposit = 417000;
  const sentMonthly = Math.floor((sentPrice - sentDeposit) / 4 / 100) * 100;
  const sentLast = sentPrice - sentDeposit - sentMonthly * 3;
  await q(
    `insert into public.proposals (id, venue_id, customer_name, customer_email, status, price, payment_type, payment_provider,
       payment_config, content, sent_at, opened_at, created_at, public_token)
     values ($1, $2, 'Camille Rousseau', 'camille.rousseau@example.com', 'opened', $3, 'installment', 'stripe',
       $4, $5, $6, $7, $6, 'showcase-proposal-token-0001')`,
    [id('80', 21), V, sentPrice,
      JSON.stringify({ installments: sentDates.map((d, i2) => ({ amount: i2 === 0 ? sentDeposit : i2 === 4 ? sentLast : sentMonthly, date: d })) }),
      PROPOSAL_HTML, daysAgo(2), daysAgo(1)],
  );

  // ── Listing traffic: couples browsing right now and through the day, so
  //    the live tiles and the visitor map have something to show ──
  await q(`delete from public.listing_events where venue_id = $1`, [V]);
  const TOWNS = [
    ['Asheville', 'NC', 35.5951, -82.5515], ['Hendersonville', 'NC', 35.3187, -82.4610],
    ['Black Mountain', 'NC', 35.6179, -82.3212], ['Waynesville', 'NC', 35.4887, -82.9887],
    ['Weaverville', 'NC', 35.6970, -82.5607], ['Brevard', 'NC', 35.2334, -82.7343],
    ['Greenville', 'SC', 34.8526, -82.3940], ['Johnson City', 'TN', 36.3134, -82.3535],
  ];
  const DEVICES = ['mobile', 'mobile', 'mobile', 'desktop', 'desktop', 'tablet'];
  const REFERRERS = ['https://www.google.com/', 'https://www.theknot.com/', null, null, 'https://www.instagram.com/'];
  // minutes ago for each browsing session: 2 on the listing right now, a
  // handful in the last half hour, the rest spread over today.
  const SESSIONS = [0.5, 1, 3, 7, 12, 18, 24, 28, 55, 90, 150, 240, 380, 520, 700, 900, 1100, 1300];
  const EVENTS_PER_SESSION = ['page_view', 'photo_view', 'scroll_50'];
  let ev = 0;
  for (const [si, minutesAgo] of SESSIONS.entries()) {
    const [city, region, lat, lng] = TOWNS[si % TOWNS.length];
    const jitter = (n) => n + (((si * 7919) % 100) - 50) * 0.0006;
    const sessionEvents = EVENTS_PER_SESSION.slice(0, 1 + (si % 3));
    for (const [ei, type] of sessionEvents.entries()) {
      ev++;
      await q(
        `insert into public.listing_events (venue_id, session_id, event_type, event_data, referrer, device_type,
           country, region, city, latitude, longitude, created_at)
         values ($1, $2, $3, '{}', $4, $5, 'US', $6, $7, $8, $9, $10)`,
        [V, `showcase-session-${si + 1}`, type, REFERRERS[si % REFERRERS.length], DEVICES[si % DEVICES.length],
          region, city, jitter(lat), jitter(lng),
          new Date(now - minutesAgo * 60_000 - ei * 45_000).toISOString()],
      );
    }
  }
  console.log(`listing traffic: ${ev} events across ${SESSIONS.length} sessions`);

  // ── The showcase couple: Emma & Ryan's Wedding Planner, filled the way a
  //    real couple's looks three months in. Everything goes through the
  //    app's own APIs so the screens read it back exactly as saved. ──
  const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  if (base) {
    const couplePassword = `Showcase-${password.slice(0, 6)}-Planner-2027!`;
    await fetch(`${base}/api/couple/signup`, {
      method: 'POST', headers: { 'x-staging-key': password, 'content-type': 'application/json' },
      body: JSON.stringify({ email: SHOWCASE.coupleEmail, password: couplePassword, first_name: 'Emma', last_name: 'Sinclair', phone: '(828) 555-0300' }),
    }); // already signed up on a rerun: fine, we sign in next
    const anon = createClient(supabaseUrl, (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim(), { auth: { persistSession: false } });
    const auth = await anon.auth.signInWithPassword({ email: SHOWCASE.coupleEmail, password: couplePassword });
    if (auth.error) throw new Error(`showcase couple sign-in: ${auth.error.message}`);
    const api = async (path, init = {}) => {
      const res = await fetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          'x-staging-key': password, authorization: `Bearer ${auth.data.session.access_token}`,
          ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      });
      if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
      return res.json().catch(() => ({}));
    };

    await api('/api/couple/profile', { method: 'PATCH', json: { first_name: 'Emma', last_name: 'Sinclair', phone: '(828) 555-0300', partner_first_name: 'Ryan', wedding_date: '2027-06-12', guest_count: 180 } });

    // The cover photo themes the planner and the wedding website.
    try {
      await api('/api/couple/site', { method: 'PUT', json: { cover_url: photo('photo-1465495976277-4387d4b0b4c6', 1800), headline: 'Emma & Ryan' } });
    } catch { /* site not set up yet on a fresh copy: the hub still shows */ }
    const docRev = async (path, key) => ((await api(path))[key]?.rev ?? 0);
    const money = (lines) => lines.map(([category, label, estimated, actual, paid], i2) => ({ id: `s${i2 + 1}`, category, label, estimated, actual, paid }));
    await api('/api/couple/budget', { method: 'PUT', json: { budget: { rev: await docRev('/api/couple/budget', 'budget'), target: 40000, lines: money([
      ['Venue', 'Willow Creek Estate — all-in', 15000, 14800, true],
      ['Photography', 'Light & Lens Co.', 4200, 4500, true],
      ['Videography', '', 2500, 0, false],
      ['Flowers & Decor', 'Wildstem Floral', 3500, 0, false],
      ['Attire', 'Dress + suit + alterations', 2800, 2650, true],
      ['Music & Entertainment', 'DJ + ceremony strings', 2400, 0, false],
      ['Hair & Makeup', '', 900, 0, false],
      ['Invitations & Stationery', '', 750, 720, true],
      ['Rings', '', 3000, 2890, true],
      ['Transportation', 'Guest shuttle', 800, 0, false],
      ['Favors & Gifts', '', 600, 0, false],
      ['Officiant', '', 500, 0, false],
    ]) } } });

    const task = (title, dueDate, done) => ({ id: `t-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`, title, dueDate, done });
    await api('/api/couple/checklist', { method: 'PUT', json: { checklist: { rev: await docRev('/api/couple/checklist', 'checklist'), items: [
      task('Tour venues', '2026-08-15', true), task('Book Willow Creek Estate', '2026-08-24', true),
      task('Set the budget', '2026-09-01', true), task('Build the guest list', '2026-10-01', true),
      task('Book photographer', '2026-10-10', true), task('Order save-the-dates', '2026-11-01', true),
      task('Book florist', '2027-01-15', true), task('Choose the menu at the tasting', '2027-02-04', true),
      task('Order invitations', '2027-02-15', false), task('Book hair & makeup trial', '2027-03-01', false),
      task('Plan the honeymoon', '2027-03-15', false), task('Final dress fitting', '2027-05-10', false),
      task('Finish the seating chart', '2027-05-25', false), task('Confirm final guest count with venue', '2027-05-29', false),
    ] } } });

    await api('/api/couple/timeline', { method: 'PUT', json: { timeline: { rev: await docRev('/api/couple/timeline', 'timeline'), events: [
      { id: 'e1', time: '13:00', title: 'Hair & makeup in the Vine Loft' },
      { id: 'e2', time: '15:00', title: 'First look in the garden' },
      { id: 'e3', time: '16:00', title: 'Ceremony under the willow arbor' },
      { id: 'e4', time: '16:45', title: 'Cocktail hour on the veranda' },
      { id: 'e5', time: '18:00', title: 'Dinner in the Grand Hall', note: 'Toasts after the first course' },
      { id: 'e6', time: '20:00', title: 'First dance' },
      { id: 'e7', time: '22:45', title: 'Sparkler send-off' },
    ] } } });

    await api('/api/couple/vendors', { method: 'PUT', json: { vendors: { rev: await docRev('/api/couple/vendors', 'vendors'), items: [
      { id: 'v1', category: 'Photographer', businessName: 'Light & Lens Co.', contactName: 'Sam Porter', phone: '(828) 555-0401', email: 'sam@example.com' },
      { id: 'v2', category: 'Florist', businessName: 'Wildstem Floral', contactName: 'Iris Bloom', phone: '(828) 555-0402', email: 'iris@example.com' },
      { id: 'v3', category: 'DJ / Band', businessName: 'Blue Ridge Beats', contactName: 'Marcus', phone: '(828) 555-0403', email: 'dj@example.com' },
      { id: 'v4', category: 'Baker', businessName: 'Sweet Laurel Cakes', contactName: 'Daphne', phone: '(828) 555-0404', email: 'cake@example.com' },
      { id: 'v5', category: 'Hair & Makeup', businessName: 'Golden Hour Beauty', contactName: 'Tess', phone: '(828) 555-0405', email: 'beauty@example.com' },
      { id: 'v6', category: 'Officiant', businessName: 'Rev. Jordan Miles', contactName: 'Jordan', phone: '(828) 555-0406', email: 'officiant@example.com' },
    ] } } });

    // Guests and seating are rows (not one saved document), so a rerun
    // clears this couple's old ones through the same doors the screens use.
    const existing = (await api('/api/couple/guests')).guests ?? [];
    for (const g of existing) await api(`/api/couple/guests/${g.id}`, { method: 'DELETE' });
    const oldTables = await api('/api/couple/tables');
    for (const t of (Array.isArray(oldTables) ? oldTables : oldTables.tables ?? [])) await api(`/api/couple/tables/${t.id}`, { method: 'DELETE' });

    const tableIds = [];
    for (const [name, capacity] of [['Head Table', 8], ['Table 1', 10], ['Table 2', 10], ['Table 3', 10], ['Table 4', 10], ['Table 5', 10]]) {
      const made = await api('/api/couple/tables', { method: 'POST', json: { name, capacity } });
      tableIds.push(made.table?.id ?? made.id);
    }
    const GUESTS = [
      ['Margaret & Tom Sinclair', 2, 'Her family', 'attending', 0], ['Carol Reyes', 1, 'Her family', 'attending', 0],
      ['The Whitfields', 2, 'Her family', 'attending', 1], ['Grandma June', 1, 'Her family', 'attending', 0],
      ['David & Anne Park', 2, 'His family', 'attending', 1], ['Uncle Joe Park', 1, 'His family', 'declined', null],
      ['The Castellanos Family', 2, 'His family', 'attending', 1], ['Nina Park', 1, 'His family', 'attending', 2],
      ['Priya & Dev Shah', 2, 'Friends', 'attending', 2], ['Jasmine Cole', 1, 'Friends', 'attending', 2],
      ['Marcus & Lena Webb', 2, 'Friends', 'attending', 3], ['Chloe Bennett', 1, 'Friends', 'pending', null],
      ['The Harringtons', 2, 'Friends', 'attending', 3], ['Zoe Ramirez', 1, 'Friends', 'attending', 3],
      ['Sam & Riley Porter', 2, 'Friends', 'attending', 4], ['Tessa Nguyen', 1, 'Friends', 'pending', null],
      ['Nora & Felix Grant', 2, 'Work', 'attending', 4], ['Camille Rousseau', 1, 'Work', 'attending', 4],
      ['Hannah Kim', 1, 'Work', 'declined', null], ['Olivia & Pete Marsh', 2, 'Work', 'attending', 5],
      ['Grace & Will Caldwell', 2, 'Friends', 'attending', 5], ['Maya Donovan', 1, 'Friends', 'pending', null],
    ];
    let seated = 0;
    for (const [i2, [full_name, party_size, guest_group, rsvp_status, tableIndex]] of GUESTS.entries()) {
      const made = await api('/api/couple/guests', { method: 'POST', json: {
        full_name, party_size, guest_group, rsvp_status,
        email: `guest.${i2 + 1}.showcase@example.com`,
      } });
      const guestId = made.guest?.id ?? made.id;
      if (tableIndex !== null && tableIds[tableIndex]) {
        await api(`/api/couple/guests/${guestId}`, { method: 'PATCH', json: { table_id: tableIds[tableIndex] } });
        seated++;
      }
    }
    console.log(`showcase couple: ${SHOWCASE.coupleEmail} — ${GUESTS.length} guest parties (${seated} seated), budget, checklist, timeline, vendors`);
  }

  const counts = {};
  for (const t of ['leads', 'conversation_threads', 'calendar_events', 'proposals', 'proposal_payments', 'proposal_installments']) {
    counts[t] = (await q(`select count(*) n from public.${t} where venue_id = $1`, [V])).rows[0].n;
  }
  counts.conversation_messages = (await q(
    `select count(*) n from public.conversation_messages where thread_id in (select id from public.conversation_threads where venue_id = $1)`, [V],
  )).rows[0].n;
  console.log(`Willow Creek Estate is set: ${JSON.stringify(counts)}`);
  console.log(`owner sign-in: ${SHOWCASE.ownerEmail} + STAGING_PASSWORD · listing /venue/${SHOWCASE.slug} · proposal /proposal/showcase-proposal-token-0001`);
  await db.end();
}

main().catch((e) => {
  console.error(hide(e?.stack ?? e?.message ?? e));
  process.exit(1);
});
