#!/usr/bin/env node
// Seed a handful of richly-populated demo venues into the dev Supabase
// project so the public directory (storyvenue.com) has something real to
// render — including reviews, map coords, social links, and FAQ entries
// added in migrations 024 / 025 / 026.
//
// Idempotent: each venue is upserted by slug. Safe to re-run.
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=... PROJECT_REF=... node scripts/seed-demo-venues.mjs

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.PROJECT_REF;
if (!token || !ref) {
  console.error('SUPABASE_ACCESS_TOKEN and PROJECT_REF required');
  process.exit(1);
}

async function runSql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Stable UUIDs so re-running replaces existing rows instead of creating dupes.
const VENUES = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    owner_id: '00000000-0000-0000-0000-000000000001',
    slug: 'retreat-at-evans-farms',
    name: 'Retreat at Evans Farms',
    description:
      "Nestled in the rolling hills of Middle Tennessee, Retreat at Evans Farms blends a restored 1890s dairy barn with a modern pavilion overlooking 40 acres of pasture. Think long farm tables, bistro lights strung across cedar beams, and golden-hour light pouring through the west-facing doors at ceremony time.\n\nOur team manages one wedding per weekend, so every couple gets the full run of the property — bridal loft, groom's quarters, ceremony meadow, and the covered reception hall.",
    venue_type: 'barn',
    location_city: 'Franklin',
    location_state: 'TN',
    location_full: 'Franklin, Tennessee',
    lat: 35.9251,
    lng: -86.8689,
    capacity_min: 80,
    capacity_max: 220,
    price_min: 12000,
    price_max: 22000,
    indoor_outdoor: 'both',
    features: [
      'ceremony_space',
      'reception_hall',
      'bridal_suite',
      'grooms_room',
      'parking',
      'catering_kitchen',
      'outdoor_ceremony',
      'indoor_reception',
      'full_service',
    ],
    cover_image_url:
      'https://images.unsplash.com/photo-1519741497674-611481863552?w=1600&q=80&auto=format&fit=crop',
    gallery_images: [
      'https://images.unsplash.com/photo-1519741497674-611481863552?w=1600&q=80&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?w=1600&q=80&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1529634597503-139d3726fed5?w=1600&q=80&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=1600&q=80&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=1600&q=80&auto=format&fit=crop',
    ],
    availability_notes:
      'Saturday evenings book 14+ months out. Fridays and Sundays often available with 4 months notice.',
    show_map: true,
    social_links: {
      website: 'https://example.com/evans-farms',
      instagram: 'https://instagram.com/evansfarms',
      facebook: 'https://facebook.com/evansfarms',
      pinterest: 'https://pinterest.com/evansfarms',
    },
    faq: [
      {
        question: 'Do you allow outside catering?',
        answer:
          'Yes — we keep an approved-caterer list of nine local teams, but we happily accept any licensed & insured caterer you prefer.',
      },
      {
        question: 'Is there a weather backup for outdoor ceremonies?',
        answer:
          "The pavilion seats 220 with a permanent cedar roof, so rain-plan is effectively no-plan: we just flip the ceremony chairs 180° and you're done.",
      },
      {
        question: 'How late can the reception run?',
        answer:
          'Music out by 10:30 PM, guests off-property by 11:00 PM. We can coordinate getaway car, shuttle staging, and vendor load-out to run cleanly against that clock.',
      },
      {
        question: 'Do you provide tables and chairs?',
        answer:
          '220 crossback chairs, 25 farm tables (seat 10 each), and a full sweetheart / head-table setup are included in every package.',
      },
    ],
    is_published: true,
    onboarding_completed: true,
    // Mock Google cache so the directory's Story/Google review toggle has
    // content to render without standing up the real Places API in dev.
    // Shape mirrors src/lib/google-place-reviews.ts#GoogleReviewsCachePayload.
    google_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
    google_reviews_cache: {
      rating: 4.9,
      userRatingCount: 128,
      reviews: [
        {
          author_name: 'Amanda P.',
          rating: 5,
          text: 'Found this venue on Google and it did not disappoint. The grounds photograph beautifully — we had a drone shoot at sunset and our photographer still sends the video to prospective clients.',
          published_at: '2025-09-02T14:11:00Z',
          profile_photo_url: null,
        },
        {
          author_name: 'Trevor S.',
          rating: 5,
          text: 'Hosted a rehearsal dinner here the night before our ceremony. Staff ran two events back-to-back without a hitch. Would book again in a heartbeat.',
          published_at: '2025-07-21T20:02:00Z',
          profile_photo_url: null,
        },
        {
          author_name: 'Kim D.',
          rating: 5,
          text: 'The driveway up is half the magic. Our parents teared up before they even got out of the car. Worth every star.',
          published_at: '2025-05-14T18:45:00Z',
          profile_photo_url: null,
        },
        {
          author_name: 'Jordan L.',
          rating: 4,
          text: 'Gorgeous property and attentive team. Only ding: cell service is spotty on the far meadow so make sure your DJ has a backup playlist cached.',
          published_at: '2024-10-07T16:20:00Z',
          profile_photo_url: null,
        },
        {
          author_name: 'Nina R.',
          rating: 5,
          text: 'We toured five venues — this one sold itself on the first walk-through. Fair pricing, transparent contract, and the coordinator responded in under an hour every single time.',
          published_at: '2024-06-30T10:15:00Z',
          profile_photo_url: null,
        },
      ],
    },
    reviews: [
      {
        rating: 5,
        reviewer_name: 'Sarah & Mike',
        title: 'Dream wedding venue',
        body:
          "We looked at probably 25 venues and Evans Farms won on the first visit. The team coordinated every detail, the barn lit up at dusk, and our guests still talk about the food and the lights. Could not have been more perfect.",
        wedding_date: '2025-05-17',
      },
      {
        rating: 5,
        reviewer_name: 'Jessica A.',
        title: 'Above and beyond',
        body:
          'Rebecca was our coordinator and she thought of things we never would have — rain plan, a quiet room for my grandmother, a shuttle loop for out-of-town guests. The property itself is stunning but the team is what made it unforgettable.',
        wedding_date: '2024-10-12',
      },
      {
        rating: 4,
        reviewer_name: 'Carlos M.',
        title: 'Loved the space, pricing felt fair',
        body:
          "Beautiful property, clean setup, well-run. Only reason it's not 5 stars is the catering kitchen felt a bit tight for our 180-guest buffet; we figured it out but the caterers had to stage in shifts.",
        wedding_date: '2025-06-28',
      },
      {
        rating: 5,
        reviewer_name: 'Priya & Arjun',
        title: 'Hosted a fusion wedding here',
        body:
          'We had a three-day fusion wedding (mehndi, sangeet, ceremony, reception) and the venue flexed with us the whole time. They helped us source a mandap, repositioned the grill area, and never once pushed back on a request. Worth every penny.',
        wedding_date: '2025-09-06',
      },
    ],
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    owner_id: '00000000-0000-0000-0000-000000000002',
    slug: 'the-barn-of-hidden-valley',
    name: 'The Barn of Hidden Valley',
    description:
      "A 1940s dairy barn reimagined as a romantic event space — whitewashed interior, exposed trusses, and a 30-foot chandelier over the dance floor. The property sits on 12 wooded acres with a stone ceremony terrace, a covered cocktail loft, and a separate photo-opportunity pond.\n\nBest for couples who want a rustic silhouette with modern finishes: heated/cooled interior, hidden production power, and fiber internet for livestream-friendly weddings.",
    venue_type: 'barn',
    location_city: 'Hendersonville',
    location_state: 'NC',
    location_full: 'Hendersonville, North Carolina',
    lat: 35.3187,
    lng: -82.4610,
    capacity_min: 50,
    capacity_max: 180,
    price_min: 8500,
    price_max: 15500,
    indoor_outdoor: 'both',
    features: [
      'ceremony_space',
      'reception_hall',
      'bridal_suite',
      'parking',
      'outdoor_ceremony',
      'indoor_reception',
      'heated_cooled',
      'photo_opps',
    ],
    cover_image_url:
      'https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=1600&q=80&auto=format&fit=crop',
    gallery_images: [
      'https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=1600&q=80&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=1600&q=80&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1515934751635-c81c6bc9a2d8?w=1600&q=80&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1478146896981-b80fe463b330?w=1600&q=80&auto=format&fit=crop',
    ],
    availability_notes:
      'Peak season (Sep–Nov) books 10+ months out. Winter weddings (Dec–Feb) are heated and often 20–30% below peak rates.',
    show_map: true,
    social_links: {
      website: 'https://example.com/hidden-valley',
      instagram: 'https://instagram.com/hiddenvalleybarn',
      tiktok: 'https://tiktok.com/@hiddenvalleybarn',
    },
    faq: [
      {
        question: 'Is the venue heated and air-conditioned?',
        answer:
          'Yes — full HVAC with zoning for the ceremony and reception halves, so you can keep the dance floor cool while the cocktail loft stays cozy.',
      },
      {
        question: "Can we bring in our own alcohol?",
        answer:
          'Absolutely. You provide the bar, we provide the TIPS-certified bartenders and all glassware/ice/garnishes. Beer + wine + 2 signature cocktails is our most-booked setup.',
      },
      {
        question: 'How does parking work?',
        answer:
          "Gravel lot holds 90 cars. For weddings over 150 guests we run a complimentary shuttle from downtown Hendersonville — it's actually a crowd favorite because nobody has to decide who's driving.",
      },
    ],
    is_published: true,
    onboarding_completed: true,
    reviews: [
      {
        rating: 5,
        reviewer_name: 'Hannah & Drew',
        title: 'Storybook fall wedding',
        body:
          "October colors through those giant barn doors — I still can't believe the photos are real. The team let us arrive early for photos and stayed late to help break down. Genuinely felt like family by the end.",
        wedding_date: '2024-10-19',
      },
      {
        rating: 5,
        reviewer_name: 'Elena R.',
        title: 'Tiny wedding, huge experience',
        body:
          "We had 55 guests and they treated it like a 200-person event. Every vendor they recommended was excellent. The pond photos are now my screensaver.",
        wedding_date: '2025-04-05',
      },
    ],
  },
];

function toSqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v) || (typeof v === 'object')) {
    return `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
  }
  return `'${String(v).replaceAll("'", "''")}'`;
}

async function main() {
  // Ensure the synthetic owner accounts exist. venues.owner_id → profiles.id
  // → auth.users.id, so we seed up the chain.
  const ownerIds = [...new Set(VENUES.map((v) => v.owner_id))];
  for (const id of ownerIds) {
    const tag = id.replaceAll('-', '').slice(-12);
    await runSql(
      `INSERT INTO auth.users (id, email) VALUES ('${id}'::uuid, 'demo+${tag}@storyvenue.local')
       ON CONFLICT (id) DO NOTHING;`,
    );
    await runSql(
      `INSERT INTO public.profiles (id, role) VALUES ('${id}'::uuid, 'venue_owner')
       ON CONFLICT (id) DO NOTHING;`,
    );
  }
  console.log(`✓ owner profiles: ${ownerIds.length}`);

  for (const v of VENUES) {
    const cols = [
      'id', 'owner_id', 'slug', 'name', 'description', 'venue_type',
      'location_city', 'location_state', 'location_full', 'lat', 'lng',
      'capacity_min', 'capacity_max', 'price_min', 'price_max',
      'indoor_outdoor', 'features', 'cover_image_url', 'gallery_images',
      'availability_notes', 'is_published', 'onboarding_completed',
      'show_map', 'social_links', 'faq',
      // Google reviews (migration 029). Only venue 1 has seed data; venue 2
      // leaves these null to verify the directory gracefully falls back to
      // the StoryVenue-only layout.
      'google_place_id', 'google_reviews_cache',
    ];
    const values = cols.map((c) => toSqlLiteral(v[c])).join(', ');
    const updates = cols
      .filter((c) => c !== 'id')
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(', ');

    // When we seed a google_reviews_cache, stamp fetched_at so the dashboard's
    // staleness check (>24h) doesn't immediately try to hit the Places API on
    // the next public page view.
    const extraSet = v.google_reviews_cache
      ? ', google_reviews_fetched_at = now()'
      : ', google_reviews_fetched_at = NULL';

    const sql = `
      INSERT INTO public.venues (${cols.join(', ')})
      VALUES (${values})
      ON CONFLICT (id) DO UPDATE SET ${updates}${extraSet};
    `;
    await runSql(sql);
    console.log(`✓ venue: ${v.slug}`);

    // Reviews: wipe and re-seed so rating count is deterministic on re-run.
    await runSql(
      `DELETE FROM public.listing_reviews WHERE venue_id = '${v.id}';`,
    );
    for (const r of v.reviews) {
      const rSql = `
        INSERT INTO public.listing_reviews
          (venue_id, rating, title, body, reviewer_name, wedding_date, status, source)
        VALUES (
          '${v.id}',
          ${r.rating},
          ${toSqlLiteral(r.title ?? null)},
          ${toSqlLiteral(r.body)},
          ${toSqlLiteral(r.reviewer_name)},
          ${toSqlLiteral(r.wedding_date ?? null)}::date,
          'published',
          'venue_dashboard'
        );
      `;
      await runSql(rSql);
    }
    console.log(`  + ${v.reviews.length} reviews`);
  }
  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
