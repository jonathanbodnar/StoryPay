import Script from 'next/script';

const GA4_ID = /^G-[A-Z0-9]+$/i;

export function Ga4Scripts({ measurementId }: { measurementId: string | null | undefined }) {
  const id = typeof measurementId === 'string' ? measurementId.trim() : '';
  if (!GA4_ID.test(id)) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-gtag-config" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', ${JSON.stringify(id)});`}
      </Script>
    </>
  );
}
