import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIRECTORY_NAV_PATH_ALIASES, DIRECTORY_NAV_REGISTRY, resolveNavIdForPath } from '@/lib/directory-nav-registry';
import { SETUP_LESSONS } from '@/lib/setup-guide';
import { webFormEmbedCode, webFormSrc } from '@/lib/web-form-embed';

const read = (path: string) => readFileSync(join(__dirname, '..', '..', path), 'utf8');

// The code a venue pastes into its own website. Oct 5 2026: it ended with
// "<\/script>" (a stray backslash), so a browser never saw the script as
// closed. Pasted into a plain page it hid whatever followed the form up to the
// page's next script, broke that script, and never passed ad-campaign tags on
// (checked in a real browser that day).
describe('the website form’s code', () => {
  const code = webFormEmbedCode(webFormSrc('https://app.example.com/', 'willow-creek'));

  it('shows the venue’s own form in a frame', () => {
    expect(webFormSrc('https://app.example.com/', 'willow creek')).toBe('https://app.example.com/api/embed/willow%20creek');
    expect(code).toContain('<iframe');
    expect(code).toContain('src="https://app.example.com/api/embed/willow-creek"');
    expect(code).toContain('id="storyvenue-guide"');
  });

  it('closes its script with a real closing tag, and has no other tag left open', () => {
    expect(code.endsWith('</script>')).toBe(true);
    expect(code).not.toContain('<\\/');
    expect(code.match(/<script>/g)).toHaveLength(1);
    expect(code.match(/<\/script>/g)).toHaveLength(1);
    expect(code.match(/<\/iframe>/g)).toHaveLength(1);
  });

  it('the Web Form page and the Pricing Guide hand out the very same code', () => {
    for (const file of ['src/app/dashboard/listing/web-form/page.tsx', 'src/app/dashboard/listing/pricing-guide/page.tsx']) {
      const source = read(file);
      expect(source, file).toContain('webFormEmbedCode(');
      expect(source, file).not.toContain('<\\\\/script>');
    }
  });
});

// The Bride Booking System submenu (owner's order, Oct 5 2026), with Web Form
// and Lead Finder as pages of their own.
describe('the Bride Booking System menu', () => {
  it('lists its pages in the owner’s order', () => {
    const sidebar = read('src/components/Sidebar.tsx');
    const block = sidebar.slice(sidebar.indexOf('const listingItems: NavItem[] = ['), sidebar.indexOf('/** Nav IDs that are always locked on the free plan'));
    const labels = [...block.matchAll(/\{ label: '([^']+)', href: '([^']+)'/g)].map((m) => `${m[1]} → ${m[2]}`);
    expect(labels).toEqual([
      'Dashboard → /dashboard/listing',
      'Venue Listing → /dashboard/listing/venue-listing',
      'Pricing Guide → /dashboard/listing/pricing-guide',
      'Reviews → /dashboard/listing/reviews',
      'Speed to Lead System → /dashboard/listing/booking-system',
      'Web Form → /dashboard/listing/web-form',
      'Lead Link → /dashboard/listing/lead-link',
      'Lead Finder → /dashboard/listing/lead-finder',
      'Ad Tracking → /dashboard/listing/ad-tracking',
    ]);
  });

  it('the two new pages are let in by the screen each grew out of, so no plan had to change', () => {
    expect(resolveNavIdForPath('/dashboard/listing/web-form')).toBe('nav_listing_pricing_guide');
    expect(resolveNavIdForPath('/dashboard/listing/lead-finder')).toBe('nav_settings_integrations');
    // Nothing else moved.
    expect(resolveNavIdForPath('/dashboard/listing/pricing-guide')).toBe('nav_listing_pricing_guide');
    expect(resolveNavIdForPath('/dashboard/listing/venue-listing')).toBe('nav_listing_dashboard');
    expect(resolveNavIdForPath('/dashboard/settings/integrations/leadfinder-review')).toBe('nav_settings_integrations');
    // An alias never invents a permission.
    const known = new Set(DIRECTORY_NAV_REGISTRY.map((e) => e.id));
    for (const alias of DIRECTORY_NAV_PATH_ALIASES) expect(known.has(alias.id), alias.pathPrefix).toBe(true);
  });

  // Owner's call (Oct 5 2026), once Lead Finder had its own page: "hide it
  // from settings, integrations. It doesn't matter anymore."
  it('Lead Finder lives on its own page only: the card is off Settings → Integrations, and nothing sends people there for it', () => {
    expect(read('src/app/dashboard/settings/integrations/page.tsx')).not.toMatch(/LeadFinderCard|Lead Finder/);
    expect(read('src/app/dashboard/listing/lead-finder/page.tsx')).toContain('<LeadFinderCard />');
    // The review screen goes back to it, and its emails and test say where it is.
    const review = read('src/app/dashboard/settings/integrations/leadfinder-review/page.tsx');
    expect(review).toContain('href="/dashboard/listing/lead-finder"');
    expect(review).toContain('Back to Lead Finder');
    for (const file of ['src/lib/leadfinder/mirror.ts', 'src/app/api/venue/leadfinder/test/route.ts', 'src/lib/help-articles.ts', 'src/app/api/ai/chat/route.ts']) {
      const pointing = read(file).split('\n').filter((line) => /Lead Finder/.test(line) && /Settings → Integrations/.test(line) && !/StoryVenue Legacy|Zapier|Generate API key/.test(line));
      expect(pointing.map((l) => l.trim().slice(0, 90)), file).toEqual([]);
    }
    expect(read('src/lib/leadfinder/mirror.ts')).toContain('Turn this copy off on your Lead Finder page.');
  });

  // Lead Finder refuses its own emailed copies when they come back, and knows
  // them by a sentence in their footer. Renaming "LeadFinder" to "Lead Finder"
  // (Oct 5 2026) reworded that sentence; copies sent before that still carry
  // the old one, and must still be known.
  it('Lead Finder still knows a copy it sent before its name became two words', () => {
    const ingest = read('src/lib/leadfinder/ingest.ts');
    expect(ingest).toContain('MIRROR_FOOTER_SENTENCES.some((sentence) => arrival.text.includes(sentence))');
    expect(ingest).toContain("const ONE_WORD = 'Lead' + 'Finder';");
    expect(ingest).toContain('`Sent by ${ONE_WORD} because a message arrived at your ${ONE_WORD} address`');
    expect(read('src/lib/leadfinder/mirror.ts')).toContain("'Sent by Lead Finder because a message arrived at your Lead Finder address'");
  });

  it('the Setup Guide and the Lead Finder emails send people to the new pages', () => {
    const byId = Object.fromEntries(SETUP_LESSONS.map((l) => [l.id, l]));
    expect(byId.web_form.cta.href).toBe('/dashboard/listing/web-form');
    expect(byId.leadfinder.cta.href).toBe('/dashboard/listing/lead-finder');
    expect(read('src/lib/leadfinder/mirror.ts')).toContain('`${APP_URL}/dashboard/listing/lead-finder`');
  });
});
