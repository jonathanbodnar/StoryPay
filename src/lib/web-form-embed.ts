/**
 * The code a venue pastes into its own website to show its inquiry form
 * (the Web Form page and the Pricing Guide's "Get Embed Code").
 *
 * It is the form in a frame, plus a few lines that pass ad-campaign tags from
 * the venue's page into the form, so a lead that came from an ad is credited
 * to it.
 *
 * Oct 5 2026: the code used to end with "<\/script>" (a stray backslash), so
 * a browser never saw the script as closed. On a plain web page that hid
 * whatever followed the form, up to the page's next script, broke that
 * script too, and the campaign tags were never passed on. It must end with a
 * real closing tag (tests/unit/web-form-embed.test.ts loads it in a page).
 */

/** Where the form itself lives: what the frame shows. */
export function webFormSrc(appUrl: string, venueSlug: string): string {
  return `${appUrl.replace(/\/+$/, '')}/api/embed/${encodeURIComponent(venueSlug)}`;
}

/** The code to paste. */
export function webFormEmbedCode(src: string): string {
  return [
    '<iframe',
    '  id="storyvenue-guide"',
    `  src="${src}"`,
    '  width="100%"',
    '  height="720"',
    '  frameborder="0"',
    '  scrolling="auto"',
    '  style="border:none;max-width:520px;"',
    '  aria-label="Pricing Guide Request"',
    '></iframe>',
    '<script>',
    "  /* Forwards Meta/UTM ad params from this page into the form so paid Meta leads are attributed correctly (the cross-origin iframe cannot read this page's URL on its own). */",
    "  (function(){try{var f=document.getElementById('storyvenue-guide');if(!f)return;var keys=['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid'];var p=new URLSearchParams(location.search);var add=false;keys.forEach(function(k){if(p.get(k))add=true;});if(!add)return;var s=new URL(f.src);keys.forEach(function(k){var v=p.get(k);if(v)s.searchParams.set(k,v);});f.src=s.toString();}catch(e){}})();",
    '</' + 'script>',
  ].join('\n');
}
