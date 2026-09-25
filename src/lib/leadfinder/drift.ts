/**
 * StoryVenue LeadFinder™ — per-source drift detection.
 *
 * A marketplace can change its notification template overnight. When it does,
 * the deterministic parser quietly stops reading fields, the AI fallback may
 * recover some of them, and the venue just sees thinner leads — with no signal
 * that anything broke. This module makes that visible.
 *
 * The rules it follows, deliberately:
 *
 *   1. Compare a source against ITS OWN past, never against other sources. A
 *      directory that always sends sparse inquiries is not "worse" than one that
 *      sends rich ones — it is just thinner, consistently.
 *   2. Require a real sample. A source with two emails can post a 100% skip rate
 *      purely by chance, so a source is only judged once it has enough arrivals
 *      in BOTH windows.
 *   3. Say so when there isn't enough history, rather than showing a false
 *      all-clear. `judged: false` + a `note` is the honest answer.
 *
 * No ML, no scoring curves — plain rates and averages with explicit thresholds.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { sourceForDomain } from '@/lib/leadfinder/extract';

// ── Thresholds (named on purpose — tune these, not the code) ─────────────────

/**
 * The recent window we judge a source on. 30 days is long enough that a normal
 * week of thin inquiry volume doesn't read as a change, and short enough that a
 * template break shows up within about a month.
 */
export const DRIFT_WINDOW_DAYS = 30;

/**
 * The earlier window we compare against — the 30 days immediately before the
 * recent window (i.e. days 30–60 ago). Same length, so the rates are directly
 * comparable without normalising.
 */
export const DRIFT_BASELINE_DAYS = 30;

/**
 * Minimum arrivals required in EACH window before a source can be flagged.
 * Five is the smallest number where a single odd message moves a rate by at most
 * 20 points, which is the rise threshold below — so one freak email can never
 * trip a drift flag on its own.
 */
export const DRIFT_MIN_SAMPLE = 5;

/**
 * How much the skipped rate must RISE (in absolute points, e.g. 0.20 = +20pp)
 * and how much it must rise RELATIVELY (1.5×) before we flag it. Requiring both
 * avoids flagging a source that merely moved from 1% to 3% skips.
 */
export const DRIFT_SKIP_RATE_RISE = 0.2;
export const DRIFT_RATE_RATIO = 1.5;

/** Same idea for the share of arrivals a human had to review. */
export const DRIFT_REVIEW_RATE_RISE = 0.2;

/**
 * How far average extraction confidence must FALL, both absolutely (−0.15) and
 * relatively (below 85% of the earlier average), before we flag it. Confidence
 * is a 0–1 score, so 0.15 is a meaningful slide, not noise.
 */
export const DRIFT_CONFIDENCE_DROP = 0.15;

/** Bucket key + label for arrivals whose sender is not a known marketplace. */
export const UNKNOWN_SOURCE_KEY = '__unknown__';
export const UNKNOWN_SOURCE_LABEL = 'Unrecognized sender';

// ── Types ────────────────────────────────────────────────────────────────────

/** One arrival row, already flattened to the fields drift needs. */
export interface DriftRow {
  detectedSource: string | null;
  senderDomain: string | null;
  processingStatus: string;
  reviewState: string | null;
  extractionConfidence: number | null;
  classificationConfidence: number | null;
  /** ISO timestamp the message arrived (falls back to created time upstream). */
  receivedAt: string | null;
}

export interface SourceDriftBucket {
  /** Stable key: the source label, or UNKNOWN_SOURCE_KEY. */
  source: string;
  label: string;
  /** Recent-window counts (last DRIFT_WINDOW_DAYS), which is what the card shows. */
  arrivals: number;
  leadsCreated: number;
  skipped: number;
  needsReview: number;
  skipRate: number;
  needsReviewRate: number;
  avgExtractionConfidence: number | null;
  avgClassificationConfidence: number | null;
  /** True when a meaningful drop against this source's own history was found. */
  drifted: boolean;
  /** Machine reasons for the flag, e.g. ['skipped_up','confidence_down']. */
  reasons: string[];
  /** False when there isn't enough history in both windows to judge honestly. */
  judged: boolean;
  /** Plain-language note for the card, especially when not judged. */
  note: string | null;
}

interface Window {
  arrivals: number;
  leads: number;
  skipped: number;
  needsReview: number;
  extractionSum: number;
  extractionCount: number;
  classificationSum: number;
  classificationCount: number;
}

function emptyWindow(): Window {
  return {
    arrivals: 0,
    leads: 0,
    skipped: 0,
    needsReview: 0,
    extractionSum: 0,
    extractionCount: 0,
    classificationSum: 0,
    classificationCount: 0,
  };
}

/** The source a row belongs to — the same resolution `sourceForDomain` defines. */
export function rowSource(row: Pick<DriftRow, 'detectedSource' | 'senderDomain'>): string {
  // Skipped rows never got a `detected_source` written, so fall back to deriving
  // it from the sender domain at read time (tolerant reader). Truly unknown
  // senders land in an explicit bucket rather than being silently dropped.
  return row.detectedSource?.trim() || sourceForDomain(row.senderDomain) || UNKNOWN_SOURCE_KEY;
}

function addToWindow(w: Window, row: DriftRow): void {
  w.arrivals += 1;
  if (row.processingStatus === 'skipped') w.skipped += 1;
  // "Needs review" means a human ever had to look — including one who has since
  // confirmed or dismissed it, because the quality signal is the queueing itself.
  if (row.reviewState && row.reviewState !== 'none') w.needsReview += 1;
  if (typeof row.extractionConfidence === 'number') {
    w.extractionSum += row.extractionConfidence;
    w.extractionCount += 1;
  }
  if (typeof row.classificationConfidence === 'number') {
    w.classificationSum += row.classificationConfidence;
    w.classificationCount += 1;
  }
}

function avg(sum: number, count: number): number | null {
  return count > 0 ? Math.round((sum / count) * 100) / 100 : null;
}

function rate(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 1000) / 1000 : 0;
}

/**
 * Compute per-source drift from already-fetched arrival rows. Pure — the caller
 * decides how far back it queried; anything outside the two windows is ignored.
 */
export function computeSourceDrift(rows: DriftRow[], now: Date = new Date()): SourceDriftBucket[] {
  const msPerDay = 24 * 60 * 60 * 1000;
  const recentStart = new Date(now.getTime() - DRIFT_WINDOW_DAYS * msPerDay).getTime();
  const baselineStart = new Date(
    now.getTime() - (DRIFT_WINDOW_DAYS + DRIFT_BASELINE_DAYS) * msPerDay,
  ).getTime();

  const recent = new Map<string, Window>();
  const baseline = new Map<string, Window>();
  const labels = new Map<string, string>();

  for (const row of rows) {
    if (!row.receivedAt) continue;
    const t = new Date(row.receivedAt).getTime();
    if (Number.isNaN(t)) continue;

    const key = rowSource(row);
    labels.set(key, key === UNKNOWN_SOURCE_KEY ? UNKNOWN_SOURCE_LABEL : key);

    if (t >= recentStart) {
      const w = recent.get(key) ?? emptyWindow();
      addToWindow(w, row);
      recent.set(key, w);
    } else if (t >= baselineStart) {
      const w = baseline.get(key) ?? emptyWindow();
      addToWindow(w, row);
      baseline.set(key, w);
    }
  }

  // Leads are read off the lead link rather than the status, because an update to
  // an existing lead is also a "lead created" event for this source's quality.
  for (const row of rows) {
    if (!row.receivedAt) continue;
    const t = new Date(row.receivedAt).getTime();
    if (Number.isNaN(t)) continue;
    const key = rowSource(row);
    if (row.processingStatus !== 'processed') continue;
    if (t >= recentStart) {
      const w = recent.get(key) ?? emptyWindow();
      w.leads += 1;
      recent.set(key, w);
    } else if (t >= baselineStart) {
      const w = baseline.get(key) ?? emptyWindow();
      w.leads += 1;
      baseline.set(key, w);
    }
  }

  const out: SourceDriftBucket[] = [];

  for (const [key, r] of recent) {
    const b = baseline.get(key) ?? emptyWindow();
    const recentSkipRate = rate(r.skipped, r.arrivals);
    const baseSkipRate = rate(b.skipped, b.arrivals);
    const recentReviewRate = rate(r.needsReview, r.arrivals);
    const baseReviewRate = rate(b.needsReview, b.arrivals);
    const avgExtraction = avg(r.extractionSum, r.extractionCount);
    const avgClassification = avg(r.classificationSum, r.classificationCount);
    const baseExtraction = avg(b.extractionSum, b.extractionCount);
    const baseClassification = avg(b.classificationSum, b.classificationCount);

    const reasons: string[] = [];
    let judged = true;
    let note: string | null = null;

    if (r.arrivals < DRIFT_MIN_SAMPLE) {
      judged = false;
      note = `Only ${r.arrivals} arrival${r.arrivals === 1 ? '' : 's'} in the last ${DRIFT_WINDOW_DAYS} days — not enough yet to judge.`;
    } else if (b.arrivals < DRIFT_MIN_SAMPLE) {
      judged = false;
      note = `${r.arrivals} arrival${r.arrivals === 1 ? '' : 's'} recently, but fewer than ${DRIFT_MIN_SAMPLE} in the ${DRIFT_BASELINE_DAYS} days before — not enough history to compare against yet.`;
    } else {
      // Risen skipped rate: must clear BOTH the absolute and relative bars.
      if (recentSkipRate >= baseSkipRate + DRIFT_SKIP_RATE_RISE && recentSkipRate >= baseSkipRate * DRIFT_RATE_RATIO) {
        reasons.push('skipped_up');
      }
      // Risen needs-review rate: more arrivals are reading thin enough that a
      // human is being asked to check them.
      if (
        recentReviewRate >= baseReviewRate + DRIFT_REVIEW_RATE_RISE &&
        recentReviewRate >= baseReviewRate * DRIFT_RATE_RATIO
      ) {
        reasons.push('needs_review_up');
      }
      // Falling extraction confidence.
      if (
        avgExtraction !== null &&
        baseExtraction !== null &&
        baseExtraction - avgExtraction >= DRIFT_CONFIDENCE_DROP &&
        avgExtraction < baseExtraction * (1 - DRIFT_CONFIDENCE_DROP)
      ) {
        reasons.push('extraction_confidence_down');
      }
      // Falling classification confidence.
      if (
        avgClassification !== null &&
        baseClassification !== null &&
        baseClassification - avgClassification >= DRIFT_CONFIDENCE_DROP &&
        avgClassification < baseClassification * (1 - DRIFT_CONFIDENCE_DROP)
      ) {
        reasons.push('classification_confidence_down');
      }
    }

    out.push({
      source: key,
      label: labels.get(key) ?? key,
      arrivals: r.arrivals,
      leadsCreated: r.leads,
      skipped: r.skipped,
      needsReview: r.needsReview,
      skipRate: recentSkipRate,
      needsReviewRate: recentReviewRate,
      avgExtractionConfidence: avgExtraction,
      avgClassificationConfidence: avgClassification,
      drifted: reasons.length > 0,
      reasons,
      judged,
      note,
    });
  }

  // Most arrivals first — the busiest source is the one most worth knowing about.
  out.sort((a, b) => b.arrivals - a.arrivals || a.label.localeCompare(b.label));
  return out;
}

/**
 * Fetch the venue's arrivals over both windows and compute the drift breakdown.
 * Bounded and small: a venue's LeadFinder traffic is low-volume by nature.
 */
export async function loadSourceDrift(venueId: string): Promise<SourceDriftBucket[]> {
  const since = new Date(
    Date.now() - (DRIFT_WINDOW_DAYS + DRIFT_BASELINE_DAYS) * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabaseAdmin
    .from('leadfinder_imports')
    .select(
      'detected_source, sender_domain, processing_status, review_state, extraction_confidence, classification_confidence, received_at, created_at',
    )
    .eq('venue_id', venueId)
    .gte('received_at', since)
    // Tests the venue sent themselves say nothing about a source's quality.
    .or('failure_reason.is.null,failure_reason.neq.test_inquiry')
    .order('received_at', { ascending: false })
    .limit(5000);

  if (error) {
    console.error('[leadfinder drift] query failed:', error.message);
    return [];
  }

  const rows: DriftRow[] = ((data ?? []) as Array<{
    detected_source: string | null;
    sender_domain: string | null;
    processing_status: string;
    review_state: string | null;
    extraction_confidence: number | null;
    classification_confidence: number | null;
    received_at: string | null;
    created_at: string | null;
  }>).map((r) => ({
    detectedSource: r.detected_source,
    senderDomain: r.sender_domain,
    processingStatus: r.processing_status,
    reviewState: r.review_state,
    extractionConfidence: r.extraction_confidence,
    classificationConfidence: r.classification_confidence,
    // `received_at` is the arrival time; fall back to the row's created time for
    // any legacy row that somehow lacks it so the row is still counted.
    receivedAt: r.received_at ?? r.created_at,
  }));

  return computeSourceDrift(rows);
}
