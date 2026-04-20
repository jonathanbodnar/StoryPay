/** GA4 web stream measurement IDs use the form G-XXXXXXXX (alphanumeric after G-). */
const GA4_MEASUREMENT_ID = /^G-[A-Z0-9]+$/i;

export function isValidGa4MeasurementId(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') return false;
  return GA4_MEASUREMENT_ID.test(id.trim());
}

/** Returns trimmed ID or null if invalid / empty. */
export function normalizeGa4MeasurementId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  return isValidGa4MeasurementId(t) ? t : null;
}

/** GA4 Admin “Property ID” (digits only), used with the Data API for in-dashboard reports. */
const GA4_PROPERTY_ID = /^\d{6,15}$/;

export function isValidGa4PropertyId(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') return false;
  return GA4_PROPERTY_ID.test(id.trim());
}

export function normalizeGa4PropertyId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  return isValidGa4PropertyId(t) ? t : null;
}
