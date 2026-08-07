/**
 * GET /api/embed/[venueSlug]
 *
 * Returns a complete, self-contained HTML page that venues can drop into an
 * <iframe> on their own website. The form mirrors the public listing lead form
 * field-for-field and submits to the same /api/public/leads endpoint so leads
 * land in the funnel, trigger Speed to Lead, and receive the pricing guide
 * exactly as they would from the StoryVenue listing page.
 *
 * Brand colours, form title, and button label are pulled from the venue's
 * saved Settings → Branding configuration and applied as CSS custom
 * properties — so updating the venue's brand in the dashboard automatically
 * refreshes the live embed with no re-copy of the snippet required.
 *
 * Source attribution: every submission from this endpoint is tagged with
 * source="embed" so it surfaces as its own slice in the funnel source chips.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';

/** Escape for HTML attribute / text content contexts. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape for use inside a JS single-quoted string literal (no HTML encoding). */
function escJs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ venueSlug: string }> },
) {
  const { venueSlug } = await params;

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select(
      'id, name, slug, brand_color, brand_bg_color, brand_btn_text, brand_logo_url, embed_form_title, embed_form_btn_label',
    )
    .eq('slug', venueSlug)
    .maybeSingle();

  if (!venue) {
    return new NextResponse('<!-- StoryVenue embed: venue not found -->', {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const v = venue as {
    id: string;
    name: string;
    slug: string;
    brand_color: string | null;
    brand_bg_color: string | null;
    brand_btn_text: string | null;
    brand_logo_url: string | null;
    embed_form_title: string | null;
    embed_form_btn_label: string | null;
  };

  const primary   = v.brand_color     || '#1b1b1b';
  const bg        = v.brand_bg_color  || '#ffffff';
  const btnText   = v.brand_btn_text  || '#ffffff';
  const logoUrl   = v.brand_logo_url  || '';
  const formTitle = v.embed_form_title    || 'Download Our Pricing Guide';
  const btnLabel  = v.embed_form_btn_label || 'Download Pricing & Availability Guide';
  const venueId   = v.id;
  const venueName = v.name;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(formTitle)}</title>
  <style>
    :root {
      --primary: ${esc(primary)};
      --bg:      ${esc(bg)};
      --btn-text:${esc(btnText)};
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: #111827;
      padding: 24px 16px 32px;
      min-height: 100vh;
    }
    .card {
      max-width: 480px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 20px;
      padding: 32px 28px;
    }
    .logo { display: block; max-height: 48px; max-width: 160px; object-fit: contain; margin-bottom: 20px; }
    .title {
      font-size: 20px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 20px;
      line-height: 1.3;
      border-bottom: 3px solid var(--primary);
      padding-bottom: 14px;
      text-align: center;
    }
    .row { display: flex; gap: 12px; }
    .field { margin-bottom: 14px; flex: 1; }
    label { display: block; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #6b7280; margin-bottom: 5px; }
    .req { color: #ef4444; }
    input, select, textarea {
      width: 100%;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 13px;
      font-family: inherit;
      color: #111827;
      background: #fff;
      outline: none;
      transition: border-color .15s;
      appearance: none;
    }
    input:focus, select:focus, textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 15%, transparent); }
    select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 36px; }
    textarea { resize: none; }
    .opt { color: #9ca3af; font-weight: 400; font-size: 10px; text-transform: none; letter-spacing: 0; }
    .btn {
      width: 100%;
      margin-top: 6px;
      background: var(--primary);
      color: var(--btn-text);
      border: none;
      border-radius: 12px;
      padding: 14px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity .15s;
    }
    .btn:hover { opacity: .88; }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    .error { margin-top: 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 10px 14px; font-size: 13px; color: #dc2626; }
    /* Success state */
    .success { display: none; text-align: center; padding: 24px 0 8px; }
    .success .check { width: 56px; height: 56px; background: #f0fdf4; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
    .success h2 { font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 10px; }
    .success p { font-size: 14px; color: #6b7280; line-height: 1.6; }
    .poweredby { margin-top: 18px; text-align: center; font-size: 10px; color: #d1d5db; }
    .poweredby a { color: #d1d5db; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    ${logoUrl ? `<img class="logo" src="${esc(logoUrl)}" alt="${esc(venueName)} logo">` : ''}
    <div class="title">${esc(formTitle)}</div>

    <!-- Form -->
    <form id="svForm">
      <div class="row">
        <div class="field">
          <label>First name <span class="req">*</span></label>
          <input name="first_name" required placeholder="First name" autocomplete="given-name">
        </div>
        <div class="field">
          <label>Last name <span class="req">*</span></label>
          <input name="last_name" required placeholder="Last name" autocomplete="family-name">
        </div>
      </div>
      <div class="field">
        <label>Email <span class="req">*</span></label>
        <input type="email" name="email" required placeholder="Email address" autocomplete="email">
      </div>
      <div class="field">
        <label>Phone <span class="req">*</span></label>
        <input type="tel" name="phone" required placeholder="Phone number" autocomplete="tel">
      </div>
      <div class="field">
        <label>When are you looking to book? <span class="req">*</span></label>
        <select name="booking_timeline" required>
          <option value="" disabled selected>Select timeline</option>
          <option>Immediately — within the next month</option>
          <option>Soon — 1 to 3 months</option>
          <option>Planning ahead — 3 to 6 months</option>
          <option>Just exploring — 6+ months out</option>
        </select>
      </div>
      <div class="field">
        <label>What matters most when choosing a venue? <span class="req">*</span></label>
        <input name="venue_matters" required placeholder="e.g. outdoor ceremony space, all-inclusive pricing…">
      </div>
      <div class="field">
        <label>Anything you'd like the venue to know? <span class="opt">(optional)</span></label>
        <textarea name="message" rows="3" placeholder="We'd love an outdoor ceremony…"></textarea>
      </div>
      <div id="svError" class="error" style="display:none;"></div>
      <button type="submit" class="btn" id="svBtn">${esc(btnLabel)}</button>
    </form>

    <!-- Success -->
    <div class="success" id="svSuccess">
      <div class="check">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
      <h2>Thanks for downloading our guide!</h2>
      <p>It's on the way to your inbox. We'll personally follow up to answer any questions you have and check your date.</p>
    </div>

    <div class="poweredby">Powered by <a href="https://storyvenue.com" target="_blank" rel="noopener">StoryVenue™</a></div>
  </div>

  <script>
    (function () {
      var form   = document.getElementById('svForm');
      var btn    = document.getElementById('svBtn');
      var errEl  = document.getElementById('svError');
      var succEl = document.getElementById('svSuccess');

      // First-touch attribution (Meta / UTM). This form is normally embedded as
      // a cross-origin <iframe> on the venue's own site, where the browser
      // forbids reading the parent page's URL directly (window.parent.location
      // throws) and strips document.referrer down to the bare origin. The
      // paste-in snippet therefore forwards any fbclid / utm_* from the parent
      // page onto THIS iframe's own query string, which we read here. For
      // same-origin embeds we also fall back to the parent URL in the referrer.
      var ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid'];
      function readAttr(qs) {
        var out = {};
        try {
          var p = new URLSearchParams(qs || '');
          for (var i = 0; i < ATTR_KEYS.length; i++) {
            var v = p.get(ATTR_KEYS[i]);
            if (v) out[ATTR_KEYS[i]] = v;
          }
        } catch (_) {}
        return out;
      }
      var attribution = readAttr(window.location.search);
      if (!attribution.fbclid && !attribution.utm_source) {
        try {
          var ref = document.referrer || '';
          var qi = ref.indexOf('?');
          if (qi >= 0) {
            var fromRef = readAttr(ref.slice(qi));
            for (var k in fromRef) { if (!attribution[k]) attribution[k] = fromRef[k]; }
          }
        } catch (_) {}
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        errEl.style.display = 'none';
        btn.disabled = true;
        btn.textContent = 'Sending…';

        var data = new FormData(form);
        var payload = Object.assign({
          venue_id:         '${esc(venueId)}',
          first_name:       data.get('first_name'),
          last_name:        data.get('last_name'),
          email:            data.get('email'),
          phone:            data.get('phone'),
          booking_timeline: data.get('booking_timeline'),
          venue_matters:    data.get('venue_matters'),
          message:          data.get('message') || undefined,
          source:           'embed',
          referrer:         document.referrer || undefined,
        }, attribution);

        fetch('${APP_URL}/api/public/embed-leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.d.error || 'Submission failed. Please try again.');
          form.style.display = 'none';
          succEl.style.display = 'block';
        })
        .catch(function (err) {
          errEl.textContent = err.message || 'Something went wrong. Please try again.';
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = '${escJs(btnLabel)}';
        });
      });
    })();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type':   'text/html; charset=utf-8',
      // Allow embedding from any origin (venue's own website).
      'X-Frame-Options': 'ALLOWALL',
      'Content-Security-Policy': "frame-ancestors *",
      // Revalidate every 5 minutes so brand changes propagate quickly.
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
    },
  });
}
