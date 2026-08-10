import { NextResponse } from 'next/server';
import { getAdminIdentity } from '@/lib/admin-identity';
import { diagnoseOwnerGhl, reconcileOwnerGhlStages } from '@/lib/owner-ghl-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Reconciling ~80+ venues serially against GHL (with pacing) can take a while.
export const maxDuration = 300;

async function isAdmin(): Promise<boolean> {
  const id = await getAdminIdentity();
  return id.isMasterSuperAdmin;
}

/**
 * GET /api/admin/owner-ghl-reconcile
 *
 * Read-only health check + dry-run report for the SaaS → GHL "SaaS Clients"
 * pipeline sync:
 *   - Confirms the pipeline/stage names resolve correctly in live GHL.
 *   - Reports, from OUR OWN venue data, what stage every non-demo venue
 *     SHOULD be in right now, and how many are already in sync vs. would
 *     need a push/move.
 * No GHL writes happen on GET.
 */
export async function GET(): Promise<NextResponse> {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const [diagnostics, report] = await Promise.all([
      diagnoseOwnerGhl(),
      reconcileOwnerGhlStages({ dryRun: true }),
    ]);
    return NextResponse.json({ diagnostics, report, dryRun: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/**
 * POST /api/admin/owner-ghl-reconcile
 *
 * Applies the reconciliation: pushes/moves every out-of-sync venue's contact
 * + opportunity in the owner's GHL "SaaS Clients" pipeline to match its
 * current lifecycle (New Listing / Trial Started / Free Listing / Paid
 * Listing, with canceled subscriptions marked "lost"). Idempotent and safe
 * to re-run — already-in-sync venues are skipped with zero GHL calls.
 */
export async function POST(): Promise<NextResponse> {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const report = await reconcileOwnerGhlStages();
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
