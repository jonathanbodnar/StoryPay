/**
 * Resolves the two directory plans that drive the self-serve free-trial flow:
 *
 *   • The "Venue Pro" paid plan — granted as a 14-day trial at signup.
 *   • The "Free" plan — the downgrade target when a trial expires.
 *
 * Plan rows are admin-created in the DB, so we resolve them at runtime rather
 * than hard-coding ids. Resolution order (first match wins):
 *   1. Explicit env override (VENUE_PRO_PLAN_ID / FREE_PLAN_ID).
 *   2. Exact slug match ('venue-pro' / 'free').
 *   3. Lowercased name match ('venue pro' / 'free').
 *   4. Heuristic: default paid plan / cheapest free plan.
 *
 * Everything is best-effort — callers must tolerate a null result (e.g. the
 * plans haven't been created yet) and skip the trial grant gracefully.
 */
import { listDirectoryPlanCatalog, type DirectoryPlanCatalogEntry } from './venue-billing';

const VENUE_PRO_SLUG = 'venue-pro';
const VENUE_PRO_NAME = 'venue pro';
const FREE_SLUG = 'free';
const FREE_NAME = 'free';

function priceOf(p: DirectoryPlanCatalogEntry): number {
  return typeof p.price_monthly_cents === 'number' ? p.price_monthly_cents : 0;
}

/**
 * The paid plan we grant as a 14-day trial when someone signs up. Returns the
 * full catalog entry (so callers can read its trial config) or null.
 */
export async function resolveVenueProPlan(
  catalog?: DirectoryPlanCatalogEntry[],
): Promise<DirectoryPlanCatalogEntry | null> {
  const plans = catalog ?? (await listDirectoryPlanCatalog());
  if (!plans.length) return null;

  const envId = process.env.VENUE_PRO_PLAN_ID?.trim();
  if (envId) {
    const hit = plans.find((p) => p.id === envId);
    if (hit) return hit;
  }

  return (
    plans.find((p) => p.slug?.toLowerCase() === VENUE_PRO_SLUG) ??
    plans.find((p) => p.name?.toLowerCase() === VENUE_PRO_NAME) ??
    plans.find((p) => p.is_default && !p.is_legacy && priceOf(p) > 0) ??
    // Fallback: cheapest non-legacy paid plan.
    plans
      .filter((p) => !p.is_legacy && priceOf(p) > 0)
      .sort((a, b) => priceOf(a) - priceOf(b))[0] ??
    null
  );
}

/** The Free plan we downgrade to when a trial expires. */
export async function resolveFreePlan(
  catalog?: DirectoryPlanCatalogEntry[],
): Promise<DirectoryPlanCatalogEntry | null> {
  const plans = catalog ?? (await listDirectoryPlanCatalog());
  if (!plans.length) return null;

  const envId = process.env.FREE_PLAN_ID?.trim();
  if (envId) {
    const hit = plans.find((p) => p.id === envId);
    if (hit) return hit;
  }

  return (
    plans.find((p) => p.slug?.toLowerCase() === FREE_SLUG) ??
    plans.find((p) => p.name?.toLowerCase() === FREE_NAME) ??
    plans.find((p) => !p.is_legacy && priceOf(p) <= 0) ??
    null
  );
}
