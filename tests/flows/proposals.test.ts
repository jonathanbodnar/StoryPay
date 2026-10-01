import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, ensureFlowVenue, env, FLOW_VENUE, runId, waitForEmail } from './helpers';

const STORYVENUE_LOGO = 'storyvenue-logo-dark.png';
// A tiny drawn signature (1×1 PNG), as the signature pad would send it.
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('an owner sends a proposal and the couple signs it', () => {
  const owner = new Browser();
  const couple = new Browser();
  const coupleEmail = `jordan.${runId}@example.com`;
  let proposal: { id: string; public_token: string; status: string } = { id: '', public_token: '', status: '' };
  let since = '';

  beforeAll(async () => {
    await ensureFlowVenue();
    await owner.signIn(FLOW_VENUE.email);
    since = new Date().toISOString();
  });

  it('sends it', async () => {
    const res = await owner.fetch('/api/proposals', {
      method: 'POST',
      json: {
        overrideContent: '<p>Wedding at Flow Test Venue on June 12, 2027. Full-day package for 120 guests.</p>',
        customerName: 'jordan ellis', customerEmail: coupleEmail, price: 500000,
        paymentType: 'full', paymentConfig: {}, collectManually: true, requireSignature: true,
      },
    });
    expect(res.status).toBe(201);
    proposal = await res.json();
    expect(proposal.status).toBe('sent');
  });

  it('emails the couple a venue-branded link to it', async () => {
    const e = await waitForEmail({ to: coupleEmail, since }, (x) => x.subject === `Proposal from ${FLOW_VENUE.name}`);
    expect(e.html).toContain(`${FLOW_VENUE.name}</p>`);
    expect(e.html).not.toContain(STORYVENUE_LOGO);
    expect(e.html).toContain(`${env.base}/proposal/${proposal.public_token}`);
  });

  it('the couple can open it without an account', async () => {
    const res = await couple.fetch(`/api/proposals/public/${proposal.public_token}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain('Full-day package');
  });

  it('refuses a signature without e-sign consent', async () => {
    const res = await couple.fetch(`/api/proposals/public/${proposal.public_token}/sign`, {
      method: 'POST', json: { signatureData: { signature_0: SIGNATURE }, consentAccepted: false },
    });
    expect(res.status).toBe(400);
  });

  it('records the signature with its legal evidence', async () => {
    const res = await couple.fetch(`/api/proposals/public/${proposal.public_token}/sign`, {
      method: 'POST', json: { signatureData: { signature_0: SIGNATURE }, consentAccepted: true },
    });
    expect(res.status).toBe(200);
    const { data } = await db.from('proposals').select('status, signed_at, signer_ip, signer_consent_text, signed_content_hash').eq('id', proposal.id).single();
    expect(data?.signed_at).toBeTruthy();
    expect(data?.signer_ip).toBeTruthy();
    expect(String(data?.signer_consent_text)).toMatch(/consent to do business electronically/);
    expect(data?.signed_content_hash).toBeTruthy();
  });

  it('sends the couple their signed copy, venue-branded, and alerts the owner', async () => {
    const copy = await waitForEmail({ to: coupleEmail, since }, (x) => x.subject === `Your signed contract with ${FLOW_VENUE.name}`);
    expect(copy.html).not.toContain(STORYVENUE_LOGO);
    const alert = await waitForEmail({ to: FLOW_VENUE.email, since }, (x) => /signed a proposal/.test(x.subject));
    expect(alert.subject).toContain('Jordan Ellis');
    expect(alert.html).toContain(STORYVENUE_LOGO);
  });

  it('cannot be signed twice', async () => {
    const res = await couple.fetch(`/api/proposals/public/${proposal.public_token}/sign`, {
      method: 'POST', json: { signatureData: { signature_0: SIGNATURE }, consentAccepted: true },
    });
    expect(res.status).toBe(400);
  });

  it('another venue cannot open it', async () => {
    const other = new Browser();
    await other.signIn(process.env.ADMIN_EMAIL || '');
    const res = await other.fetch(`/api/proposals/${proposal.id}`);
    expect([403, 404]).toContain(res.status);
  });
});
