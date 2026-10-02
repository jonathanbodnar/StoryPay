import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, FLOW_VENUE, runId } from './helpers';

// The venue's directory listing and pricing guide, from the editor to what the
// public sees: saved details show once published and disappear when
// unpublished, a link name another venue has is refused, reviews show until
// hidden, and the pricing guide comes out as a PDF.
describe('the listing and pricing guide', () => {
  const email = `listing.${runId}@example.com`;
  const slug = `listing-${runId}`;
  const owner = new Browser();
  let venueId = '';

  const listing = (json: Record<string, unknown>) => owner.fetch('/api/listing/me', { method: 'PATCH', json });
  const publicListing = () => fetch(`${env.base}/api/public/venues/${slug}`, { headers: { 'x-staging-key': env.stagingKey } });

  beforeAll(async () => {
    const res = await owner.fetch('/api/auth/signup', {
      method: 'POST', json: { venue_name: `Listing Barn ${runId}`, first_name: 'Lia', last_name: 'Sting', email, phone: '(212) 555-0165', password: `Listing-${runId}-Barn-2027!` },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    venueId = (await db.from('venues').select('id').ilike('email', email).single()).data!.id;
  });

  it('saved details show publicly once published, and go away when unpublished', async () => {
    const saved = await listing({
      slug, description: `A restored 1890s barn ${runId}`, capacity_max: 180, location_city: 'Asheville', location_state: 'NC',
      faq: [{ question: 'Can we bring our own caterer?', answer: 'Yes, from our list.' }],
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(JSON.stringify(await (await owner.fetch('/api/listing/me')).json())).toContain(`A restored 1890s barn ${runId}`);
    expect((await publicListing()).status).toBe(404); // not published yet

    expect((await listing({ is_published: true })).status).toBe(200);
    const pub = await publicListing();
    expect(pub.status).toBe(200);
    const body = JSON.stringify(await pub.json());
    expect(body).toContain(`A restored 1890s barn ${runId}`);
    expect(body).toContain('Can we bring our own caterer?');
    // Nothing private comes along.
    expect(body).not.toContain(email);
    expect(body).not.toContain('password');

    expect((await listing({ is_published: false })).status).toBe(200);
    expect((await publicListing()).status).toBe(404);
  });

  it('a link name another venue already has is refused', async () => {
    const res = await listing({ slug: FLOW_VENUE.slug });
    expect(res.status).toBe(409);
    expect((await db.from('venues').select('slug').eq('id', venueId).single()).data!.slug).toBe(slug);
  });

  it('a review shows on the listing until it’s hidden, and can be deleted', async () => {
    expect((await owner.fetch('/api/listing/reviews', { method: 'POST', json: { rating: 6, body: 'x', reviewer_name: 'x' } })).status).toBe(400);
    const made = await owner.fetch('/api/listing/reviews', { method: 'POST', json: { rating: 5, body: `Magical day ${runId}`, reviewer_name: 'Pat Review', wedding_date: '2026-09-12' } });
    expect(made.status, await made.clone().text()).toBeLessThan(300);
    const { data: review } = await db.from('listing_reviews').select('id, status').eq('venue_id', venueId).ilike('body', `%Magical day ${runId}%`).single();
    expect(review!.status).toBe('published');

    expect((await listing({ is_published: true })).status).toBe(200);
    expect(JSON.stringify(await (await publicListing()).json())).toContain(`Magical day ${runId}`);
    expect((await owner.fetch(`/api/listing/reviews/${review!.id}`, { method: 'PATCH', json: { status: 'hidden' } })).status).toBeLessThan(300);
    expect(JSON.stringify(await (await publicListing()).json())).not.toContain(`Magical day ${runId}`);
    expect((await owner.fetch(`/api/listing/reviews/${review!.id}`, { method: 'DELETE' })).status).toBeLessThan(300);
    expect((await db.from('listing_reviews').select('id').eq('id', review!.id).maybeSingle()).data).toBeNull();
  });

  it('the pricing guide saves its parts and comes out as a PDF', async () => {
    const guide = await owner.fetch('/api/listing/pricing-guide', {
      method: 'PATCH', json: { enabled: true, about_venue: `Twenty acres of meadow ${runId}`, cta_headline: `Book your tour ${runId}` },
    });
    expect(guide.status, await guide.clone().text()).toBe(200);
    const pkg = await owner.fetch('/api/listing/pricing-guide/packages', { method: 'POST', json: { name: `Saturday package ${runId}` } });
    expect(pkg.status, await pkg.clone().text()).toBeLessThan(300);
    const saved = JSON.stringify(await (await owner.fetch('/api/listing/pricing-guide')).json());
    expect(saved).toContain(`Twenty acres of meadow ${runId}`);
    expect(saved).toContain(`Saturday package ${runId}`);

    const pdf = await fetch(`${env.base}/api/public/venue/${venueId}/pricing-guide`, { headers: { 'x-staging-key': env.stagingKey } });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toContain('pdf');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(2000);

    const { data: packages } = await db.from('venue_pricing_guide_packages').select('id').eq('venue_id', venueId);
    for (const p of packages ?? []) {
      expect((await owner.fetch(`/api/listing/pricing-guide/packages/${p.id}`, { method: 'DELETE' })).status).toBeLessThan(300);
    }
  });
});
