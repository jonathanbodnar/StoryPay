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

  it('the Setup Guide and the Lead Finder emails send people to the new pages', () => {
    const byId = Object.fromEntries(SETUP_LESSONS.map((l) => [l.id, l]));
    expect(byId.web_form.cta.href).toBe('/dashboard/listing/web-form');
    expect(byId.leadfinder.cta.href).toBe('/dashboard/listing/lead-finder');
    expect(read('src/lib/leadfinder/mirror.ts')).toContain('`${APP_URL}/dashboard/listing/lead-finder`');
  });
});
