import Script from 'next/script';
import { isValidGa4MeasurementId } from '@/lib/ga4';

/**
 * Loads gtag.js for a GA4 web stream when a valid Measurement ID is present.
 */
export function Ga4Scripts({ measurementId }: { measurementId: string | null | undefined }) {
  const id = typeof measurementId === 'string' ? measurementId.trim() : '';
  if (!isValidGa4MeasurementId(id)) return null;

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
