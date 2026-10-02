import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, FLOW_VENUE, runId } from './helpers';

// Uploads, on a fresh venue: the brand logo (photos only), a file attached to a
// contact (listed, opened, removed; only for the venue's own contacts), and
// contacts imported from a CSV.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

describe('uploads', () => {
  const email = `media.${runId}@example.com`;
  const owner = new Browser();
  let venueId = '';

  const upload = (path: string, bytes: Buffer, type: string, name: string) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
    return owner.fetch(path, { method: 'POST', body: form });
  };

  beforeAll(async () => {
    const res = await owner.fetch('/api/auth/signup', {
      method: 'POST', json: { venue_name: `Media Barn ${runId}`, first_name: 'Mia', last_name: 'Dia', email, phone: '(212) 555-0167', password: `Media-${runId}-Barn-2027!` },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    venueId = (await db.from('venues').select('id').ilike('email', email).single()).data!.id;
  });

  it('the logo uploads and is served as an image; anything but a photo is refused', async () => {
    const res = await upload('/api/venues/upload-logo', PNG, 'image/png', 'logo.png');
    expect(res.status, await res.clone().text()).toBe(200);
    const { data } = await db.from('venues').select('brand_logo_url').eq('id', venueId).single();
    expect(data!.brand_logo_url).toMatch(/^https:\/\//);
    const img = await fetch(data!.brand_logo_url);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect((await upload('/api/venues/upload-logo', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml', 'logo.svg')).status).toBe(400);
  });

  it('a file on a contact is listed, opens, and is removed; only the venue’s own contacts take files', async () => {
    const c = await owner.fetch('/api/venue-customers', { method: 'POST', json: { customer_email: `filed.${runId}@example.com`, first_name: 'Fay', last_name: 'Filed' } });
    expect(c.status, await c.clone().text()).toBeLessThan(300);
    const { data: contact } = await db.from('venue_customers').select('id').eq('venue_id', venueId).ilike('customer_email', `filed.${runId}@example.com`).single();
    const path = `/api/venue-customers/${contact!.id}/files`;

    expect((await upload(path, Buffer.from('MZ'), 'application/x-msdownload', 'setup.exe')).status).toBe(400);
    const res = await upload(path, PDF, 'application/pdf', 'contract.pdf');
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const list = (await (await owner.fetch(path)).json()) as { files?: Array<{ id: string; filename: string; url?: string; signed_url?: string }> } | Array<{ id: string; filename: string; url?: string; signed_url?: string }>;
    const files = Array.isArray(list) ? list : list.files ?? [];
    const file = files.find((f) => f.filename === 'contract.pdf')!;
    const link = file.url ?? file.signed_url;
    expect(link).toBeTruthy();
    const opened = await fetch(link!);
    expect(opened.status).toBe(200);
    expect(Buffer.from(await opened.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await owner.fetch(`${path}?fileId=${file.id}`, { method: 'DELETE' })).status).toBeLessThan(300);
    expect((await db.from('customer_files').select('id').eq('id', file.id).maybeSingle()).data).toBeNull();

    const { data: theirs } = await db.from('venue_customers').select('id').eq('venue_id', FLOW_VENUE.id).limit(1).maybeSingle();
    if (theirs) {
      expect((await upload(`/api/venue-customers/${theirs.id}/files`, PDF, 'application/pdf', 'x.pdf')).status).toBe(404);
      expect((await db.from('customer_files').select('id').eq('customer_id', theirs.id).eq('venue_id', venueId)).data).toEqual([]);
    }
  });

  it('contacts come in from a CSV', async () => {
    const csv = `email,first_name,last_name,phone\nimport.a.${runId}@example.com,Ida,Import,(212) 555-0171\nimport.b.${runId}@example.com,Ian,Import,(212) 555-0172\n`;
    const res = await owner.fetch('/api/contacts/import', { method: 'POST', headers: { 'content-type': 'text/csv' }, body: csv });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const { data } = await db.from('venue_customers').select('first_name').eq('venue_id', venueId).ilike('customer_email', `import.%.${runId}@example.com`);
    expect(data!.map((r) => r.first_name).sort()).toEqual(['Ian', 'Ida']);
    expect((await owner.fetch('/api/contacts/import', { method: 'POST', headers: { 'content-type': 'text/csv' }, body: 'name\nNo Email\n' })).status).toBe(400);
  });
});
