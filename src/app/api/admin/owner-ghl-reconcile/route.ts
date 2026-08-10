import { NextRequest, NextResponse } from 'next/server';
import { getAdminIdentity } from '@/lib/admin-identity';
import { diagnoseOwnerGhl, reconcileOwnerGhlStages } from '@/lib/owner-ghl-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
 * Fast and synchronous — no GHL writes happen here, so this always returns
 * quickly regardless of how many venues need syncing.
 *
 * Pass ?apply=1 to KICK OFF the real sync in the background (see POST doc
 * below) — this returns almost immediately with an estimate; it does NOT
 * wait for the sync to finish, since syncing 80+ venues serially against
 * GHL can take several minutes and would otherwise hang the request/proxy.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const apply = req.nextUrl.searchParams.get('apply') === '1';
  try {
    const [diagnostics, report] = await Promise.all([
      diagnoseOwnerGhl(),
      reconcileOwnerGhlStages({ dryRun: true }),
    ]);
    if (!apply) {
      return NextResponse.json({ diagnostics, report, dryRun: true });
    }
    startBackgroundReconcile();
    return NextResponse.json({
      ok: true,
      started: true,
      message:
        `Reconciliation started in the background for up to ${report.totalEligible - report.alreadyInSync} ` +
        `out-of-sync venue(s) (of ${report.totalEligible} eligible). This can take a few minutes on the ` +
        `first run. Re-visit this URL WITHOUT ?apply=1 in a bit to see updated counts, or check Railway logs ` +
        `for "[owner-ghl-reconcile]" lines.`,
      estimate: report,
      diagnostics,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** Guards against two overlapping background runs if the admin double-clicks / double-visits. */
let reconcileInFlight = false;

function startBackgroundReconcile(): void {
  if (reconcileInFlight) {
    console.log('[owner-ghl-reconcile] skip: a reconciliation is already running in the background');
    return;
  }
  reconcileInFlight = true;
  const startedAt = Date.now();
  void reconcileOwnerGhlStages()
    .then((report) => {
      console.log(
        `[owner-ghl-reconcile] DONE in ${Math.round((Date.now() - startedAt) / 1000)}s — ` +
          `eligible=${report.totalEligible} already_in_sync=${report.alreadyInSync} ` +
          `synced=${report.synced} failed=${report.failed} by_stage=${JSON.stringify(report.byTargetStage)}` +
          (report.failedVenueIds.length ? ` failed_ids=${report.failedVenueIds.join(',')}` : ''),
      );
    })
    .catch((err) => {
      console.error('[owner-ghl-reconcile] background run FAILED', err);
    })
    .finally(() => {
      reconcileInFlight = false;
    });
}

/**
 * POST /api/admin/owner-ghl-reconcile
 *
 * Starts the reconciliation in the background and returns immediately
 * (fire-and-forget — see startBackgroundReconcile). Pushes/moves every
 * out-of-sync venue's contact + opportunity in the owner's GHL "SaaS
 * Clients" pipeline to match its current lifecycle (New Listing / Trial
 * Started / Free Listing / Paid Listing, with canceled subscriptions marked
 * "lost"). Idempotent and safe to re-run — already-in-sync venues are
 * skipped with zero GHL calls.
 */
export async function POST(): Promise<NextResponse> {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const preview = await reconcileOwnerGhlStages({ dryRun: true });
    startBackgroundReconcile();
    return NextResponse.json({
      ok: true,
      started: true,
      message: `Reconciliation started in the background for up to ${preview.totalEligible - preview.alreadyInSync} venue(s).`,
      estimate: preview,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
