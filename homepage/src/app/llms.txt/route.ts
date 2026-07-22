/**
 * GET /llms.txt — description of this site for AI answer engines (AEO).
 * https://llmstxt.org/
 */

const SITE_URL = (
  process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'https://storyvenue.com'
).replace(/\/$/, '');

export const dynamic = 'force-static';

const BODY = `# StoryVenue

> StoryVenue is a wedding venue directory where couples compare venue pricing, availability, guest capacity, photos, and verified reviews, then request pricing guides and book venue tours online. Every listing is published and maintained by the venue itself through the StoryVenue Bride Booking System.

Each venue listing page includes: venue name and location, venue type (barn, ballroom, garden, estate, and more), indoor/outdoor setting, guest capacity, starting price, amenities, photo gallery, frequently asked questions, verified couple reviews, and a form to request the venue's pricing and availability guide.

## Key pages

- [Venue directory](${SITE_URL}/venues): search wedding venues by city and state
- [Sitemap](${SITE_URL}/sitemap.xml): all venue listing pages and city/state browse pages

## For venues

- Wedding venues can list on StoryVenue and manage inquiries with the Bride Booking System at https://app.storyvenue.com
`;

export async function GET(): Promise<Response> {
  return new Response(BODY, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
