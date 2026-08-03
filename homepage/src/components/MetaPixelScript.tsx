import Script from 'next/script';

/** Meta (Facebook) Pixel IDs are purely numeric, typically 15-16 digits. */
const META_PIXEL_ID = /^\d{5,20}$/;

/**
 * Meta's standard client-side Pixel base code, rendered ONLY on the
 * guide-download thank-you page — never on the public listing page. Fires a
 * `PageView` on load so a venue can create a URL-based Custom Conversion in
 * Meta Events Manager (rule: URL contains "/thankyou") with zero server-side
 * integration required; just their Pixel ID.
 */
export function MetaPixelScript({ pixelId }: { pixelId: string | null | undefined }) {
  const id = typeof pixelId === 'string' ? pixelId.trim() : '';
  if (!META_PIXEL_ID.test(id)) return null;

  return (
    <>
      <Script id="meta-pixel-thankyou" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', ${JSON.stringify(id)});
fbq('track', 'PageView');`}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element -- noscript fallback pixel must be a plain <img>, next/image requires JS */}
        <img
          height="1"
          width="1"
          alt=""
          style={{ display: 'none' }}
          src={`https://www.facebook.com/tr?id=${encodeURIComponent(id)}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
