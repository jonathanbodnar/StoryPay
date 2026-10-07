import { describe, expect, it } from 'vitest';
import { everyRow, ROWS_PER_ANSWER } from '@/lib/in-batches';
import { teamMemberForBrowser, TEAM_MEMBER_FIELDS } from '@/lib/team-member-shape';
import { venueForBrowser } from '@/lib/venue-for-browser';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (path: string) => readFileSync(join(__dirname, '..', '..', path), 'utf8');

// The database answers with 1,000 rows at most. A list read in one request is
// cut there and nothing says so (a campaign to "all leads" at a venue with
// more than a thousand reached the first thousand).
describe('reading a list to its end', () => {
  const table = Array.from({ length: 2345 }, (_, i) => ({ n: i }));
  const page = (from: number, to: number) => Promise.resolve({ data: table.slice(from, to + 1), error: null });

  it('asks page after page until one comes back short', async () => {
    const asked: Array<[number, number]> = [];
    const res = await everyRow<{ n: number }>((from, to) => { asked.push([from, to]); return page(from, to); });
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(2345);
    expect(res.data[2344].n).toBe(2344);
    expect(asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(ROWS_PER_ANSWER).toBe(1000);
  });

  it('a list that ends exactly on a page asks once more and finds nothing', async () => {
    const exact = table.slice(0, 2000);
    let calls = 0;
    const res = await everyRow<{ n: number }>((from, to) => { calls += 1; return Promise.resolve({ data: exact.slice(from, to + 1), error: null }); });
    expect(res.data).toHaveLength(2000);
    expect(calls).toBe(3);
  });

  it('stops at the first failure and says so, with what it had read', async () => {
    const res = await everyRow<{ n: number }>((from, to) => (from >= 1000 ? Promise.resolve({ data: null, error: { message: 'no' } }) : page(from, to)));
    expect(res.error).toEqual({ message: 'no' });
    expect(res.data).toHaveLength(1000);
  });

  it('a campaign’s audience reads every list this way, and gives nobody rather than some when one can’t be read', () => {
    const audience = src('src/lib/marketing-email-audience.ts');
    const body = audience.slice(audience.indexOf('export async function resolveCampaignRecipients'), audience.indexOf('export async function countCampaignRecipients'));
    // No list is read in one plain request any more.
    expect(body).not.toMatch(/await supabaseAdmin\s*\.from\(/);
    expect(body.match(/everyRow</g)?.length).toBeGreaterThanOrEqual(4);
    expect(body).toMatch(/if \(supErr\) return \[\];/);
  });
});

// The team list is read by every signed-in team member's screens. It carried
// each teammate's invite token (their emailed sign-in link, and their password
// until they set one) and password hash.
describe('what a browser is told about a team member', () => {
  const row = {
    id: 'm1', venue_id: 'v1', name: 'Ada Admin', first_name: 'Ada', last_name: 'Admin', email: 'ada@example.com', phone: null,
    role: 'admin', status: 'active', invited_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z', hide_revenue: false,
    invite_token: '3f0c7c4e-0000-4000-8000-000000000000', password_hash: '$2b$10$abcdefghijklmnopqrstuv', session_invalidated_before: null,
    admin_notes: 'internal', blocked_reason: null, notification_settings: {}, concierge_ghl_contact_id: 'abc',
  };

  it('names, role and contact details; never what signs them in, or our notes', () => {
    const told = teamMemberForBrowser(row);
    expect(told).toMatchObject({ id: 'm1', first_name: 'Ada', email: 'ada@example.com', role: 'admin', status: 'active', phone: null, hide_revenue: false });
    for (const secret of ['invite_token', 'password_hash', 'session_invalidated_before', 'admin_notes', 'blocked_reason', 'notification_settings', 'concierge_ghl_contact_id']) {
      expect(told, secret).not.toHaveProperty(secret);
    }
    expect(Object.keys(told).every((k) => (TEAM_MEMBER_FIELDS as readonly string[]).includes(k))).toBe(true);
  });

  it('every team route that answers with a member answers with that', () => {
    expect(src('src/app/api/team/route.ts')).toMatch(/NextResponse\.json\(members\.map\(teamMemberForBrowser\)\)/);
    expect(src('src/app/api/team/route.ts')).not.toMatch(/invite_url: inviteUrl/);
    expect(src('src/app/api/team/[id]/route.ts')).toMatch(/NextResponse\.json\(teamMemberForBrowser\(data/);
    expect(src('src/app/api/team/[id]/route.ts')).not.toMatch(/NextResponse\.json\(data\)/);
    expect(src('src/app/api/team/[id]/resend-invite/route.ts')).toMatch(/\.\.\.teamMemberForBrowser\(member/);
  });

  it('the owner’s sign-in email and password are not changed from the team list', () => {
    const route = src('src/app/api/team/[id]/route.ts');
    expect(route).not.toMatch(/ownerUpdates\.password_hash\s*=/);
    expect(route).not.toMatch(/ownerUpdates\.email\s*=/);
    expect(route).toMatch(/in My Profile, under Login & Security/);
  });
});

// A venue's own record goes to every signed-in session of the venue. It
// carried the whole row, with three tokens masked.
describe('a venue’s record, as its browsers may have it', () => {
  const row = {
    id: 'v1', name: 'The Barn', email: 'owner@example.com', brand_color: '#1b1b1b', seo_keywords: 'barn, wedding', timezone: 'America/New_York',
    password_hash: '$2b$10$abcdefghijklmnopqrstuv', login_token: 'tok-login', admin_login_token: 'tok-admin', email_verification_token: 'tok-verify',
    login_token_expires_at: '2026-10-08T00:00:00Z', session_invalidated_before: '2026-10-01T00:00:00Z', demo_preview_token: 'tok-demo',
    lunarpay_secret_key: 'sk_live_abcdef', lunarpay_org_token: 'org_abcdef', lunarpay_publishable_key: 'pk_live_abcdef',
    ghl_access_token: 'pit-1234567890', ghl_location_token: 'loc-0987654321', ghl_refresh_token: 'refresh-me', ghl_location_id: 'LOC123',
    meta_capi_access_token: 'EAABmeta5678', calendly_access_token: 'cal-token-4321', calendly_webhook_signing_key: 'whsec_abc', eventtemple_api_key: 'et-key-8765',
    tripleseat_public_key: 'ts-public',
    // Columns nobody has thought of yet.
    some_new_api_key: 'new-key', some_new_secret: 'shh', widget_private_key_pem: '-----BEGIN', backup_password: 'hunter2',
  };
  const told = venueForBrowser(row);

  it('never what signs someone in, or what a third party’s key can do', () => {
    for (const gone of ['password_hash', 'login_token', 'admin_login_token', 'email_verification_token', 'session_invalidated_before', 'demo_preview_token',
      'lunarpay_secret_key', 'lunarpay_org_token', 'calendly_webhook_signing_key']) {
      expect(told, gone).not.toHaveProperty(gone);
    }
    const text = JSON.stringify(told);
    for (const value of ['$2b$', 'tok-login', 'tok-admin', 'sk_live_abcdef', 'org_abcdef', 'pit-1234567890', 'loc-0987654321', 'refresh-me', 'EAABmeta5678', 'cal-token-4321', 'whsec_abc', 'et-key-8765']) {
      expect(text, value).not.toContain(value);
    }
  });

  it('a connection’s key shows as on file: dots and its last four', () => {
    expect(told).toMatchObject({
      ghl_access_token: '••••7890', ghl_location_token: '••••4321', meta_capi_access_token: '••••5678', calendly_access_token: '••••4321',
      eventtemple_api_key: '••••8765', ghl_refresh_token: '••••',
    });
    expect(venueForBrowser({ ghl_access_token: null, eventtemple_api_key: '' })).toEqual({ ghl_access_token: null, eventtemple_api_key: null });
  });

  it('a column added later whose name says it is a secret is left out too', () => {
    for (const gone of ['some_new_api_key', 'some_new_secret', 'widget_private_key_pem', 'backup_password']) expect(told, gone).not.toHaveProperty(gone);
  });

  it('everything the screens read is still there', () => {
    expect(told).toMatchObject({
      id: 'v1', name: 'The Barn', email: 'owner@example.com', brand_color: '#1b1b1b', seo_keywords: 'barn, wedding', timezone: 'America/New_York',
      ghl_location_id: 'LOC123', lunarpay_publishable_key: 'pk_live_abcdef', tripleseat_public_key: 'ts-public', login_token_expires_at: '2026-10-08T00:00:00Z',
    });
  });

  it('the venue’s settings route answers with that, reading and saving', () => {
    const route = src('src/app/api/venues/me/route.ts');
    expect(route).toMatch(/\.\.\.venueForBrowser\(venue as Record<string, unknown>\)/);
    expect(route).not.toMatch(/NextResponse\.json\(venue\)/);
    expect(route).not.toMatch(/NextResponse\.json\(\{\s*\.\.\.venue,/);
  });
});
