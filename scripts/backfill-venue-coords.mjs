import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });
const NOMINATIM_UA = 'StoryVenueGeocoder/1.0 (app.storyvenue.com)';

const clean = (s) => (s && String(s).trim() ? String(s).trim() : '');

function buildCandidates(v) {
  const street = clean(v.location_full) || clean(v.address) || clean(v.brand_address);
  const city = clean(v.location_city) || clean(v.city) || clean(v.brand_city);
  const state = clean(v.location_state) || clean(v.state) || clean(v.brand_state);
  const zip = clean(v.zip) || clean(v.brand_zip);
  const alreadyHas = (part) => !!part && street.toLowerCase().includes(part.toLowerCase());
  const out = [];
  const parts = [];
  if (street) parts.push(street.replace(/,\s*$/, ''));
  if (city && !alreadyHas(city)) parts.push(city);
  if (state && !alreadyHas(state)) parts.push(state);
  let full = parts.join(', ').trim();
  if (zip && !full.includes(zip)) full = `${full} ${zip}`.trim();
  full = full.replace(/^,\s*/, '').trim();
  if (full) out.push(full);
  const cityState = [city, state].filter(Boolean).join(', ').trim();
  if (cityState) out.push(cityState);
  if (zip) out.push(`${zip}, USA`);
  return [...new Set(out)];
}

async function geocode(query) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': NOMINATIM_UA }, cache: 'no-store' }
  );
  if (!res.ok) return null;
  const arr = await res.json();
  const f = arr?.[0];
  if (!f?.lat || !f?.lon) return null;
  const lat = parseFloat(f.lat), lng = parseFloat(f.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

const rows = await sql`
  select id, name, lat, lng, location_full, location_city, location_state,
         address, city, state, zip, brand_address, brand_city, brand_state, brand_zip
  from venues
  where lat is null or lng is null
  order by name`;

console.log(`Venues missing coords: ${rows.length}`);
let fixed = 0, skipped = 0, failed = 0;
for (const v of rows) {
  const candidates = buildCandidates(v);
  if (candidates.length === 0) { skipped++; continue; }
  let geo = null, used = null;
  try {
    for (const q of candidates) {
      geo = await geocode(q);
      used = q;
      if (geo) break;
      await new Promise((r) => setTimeout(r, 1200)); // Nominatim: ~1 req/sec
    }
    if (!geo) { console.log(`  MISS  ${v.name} :: [${candidates.join(' | ')}]`); failed++; }
    else {
      await sql`update venues set lat=${geo.lat}, lng=${geo.lng} where id=${v.id} and lat is null`;
      console.log(`  OK    ${v.name} :: "${used}" -> ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`);
      fixed++;
    }
  } catch (e) {
    console.log(`  ERR   ${v.name} :: ${e.message}`);
    failed++;
  }
  await new Promise((r) => setTimeout(r, 1200)); // Nominatim: ~1 req/sec
}

console.log(`\nDone. fixed=${fixed} failed=${failed} skipped(no-location)=${skipped}`);
await sql.end();
