/**
 * Release-lane rules for check-deploy.mjs, kept pure so the fast checks can
 * hold them still (tests/unit/release-lanes.test.ts):
 *
 *  - laneFor: a commit whose whole diff against what's live ships nothing
 *    (scripts, tests, docs) earns the smoke lane; anything else runs the
 *    full suite. Unknown diffs run the full suite.
 *  - targetedFlowFiles: the flow tests that cover the changed area, run
 *    FIRST so a broken change fails in the first minutes, not after the
 *    whole suite.
 *  - trailingBase: what a hot release's trailing check compares against. A
 *    fix released over a version whose own check never came back clean
 *    answers for that version's changes too (fix-forward).
 *  - flowFilesToRerun: when a flow-test stage fails in only a few files, and
 *    every failure in them looks like the connection (a dropped request, a
 *    failed name lookup, a timeout), those files get one more run before the
 *    stage is called failed. A failed ASSERTION never gets a second run: on
 *    Oct 5 2026 a test that failed only inside the full run (two tests shared
 *    a phone number) passed alone, and the second run hid it. What was rerun
 *    is recorded and reported.
 *  - sleepsDuring: how often this computer went to sleep while the checks
 *    ran. A run that slept isn't a verdict (its tests time out and drop
 *    their connections whatever the code does), so it's run again.
 */

/** Paths that never ship with the app. */
const NOT_SHIPPED = [/^scripts\//, /^tests\//, /^docs\//, /^\.claude\//, /^\.gitignore$/, /\.md$/i];

/**
 * The areas the owner keeps behind the full gate no matter what (decided
 * 2026-10-03): money, messages to real people, sign-in, and the database.
 * A hot release refuses a commit touching any of these — a wrong charge or
 * text can't be rolled back, and a migration can't be un-run.
 */
const SENSITIVE = [
  // Database
  /^migrations\//,
  // Dependencies change everything at once
  /^package(-lock)?\.json$/,
  // Payments and billing
  /^src\/lib\/stripe\//, /^src\/lib\/(payment|proposal-payments|service-fee|platform-billing|platform-directory-billing|saas-billing|venue-billing|lunarpay)/,
  /^src\/app\/api\/(payments|venue-billing|transactions|invoices|card-update|lunarpay)\//,
  /^src\/app\/api\/webhooks\/(stripe|stripe-connect|lunarpay)\//,
  /^src\/app\/api\/proposals\/public\//, // couples pay and sign here
  /^src\/app\/api\/cron\/(installments|payment-reminders)\//,
  // Texting and automated messages to real people
  /^src\/lib\/(ghl|sms|texting-hours|concierge-sms|marketing-email-worker|reengagement-drip|appointment-reminders|guide-invite)/,
  /^src\/lib\/ai-concierge\//,
  /^src\/app\/api\/webhooks\/(ghl|ghl-workflow-inbound|inbound-email|calendly)\//,
  // Sign-in and sessions
  /^src\/proxy\.ts$/, /^src\/instrumentation\.ts$/,
  /^src\/lib\/(session|venue-session|auth-helpers|admin-auth|admin-token|admin-identity|admin-impersonation|couple-server|password-policy|crypto-tokens|oauth-state|totp|twofa|staging-access|secure-compare|api-keys|api-v1-auth)/,
  /^src\/lib\/support\/auth\.ts$/,
  /^src\/app\/api\/auth\//, /^src\/app\/api\/admin\/(login|auth|support)\//,
];

/** The changed files a hot release must refuse (empty = safe to ship hot). */
export function sensitiveFiles(changedFiles) {
  return (changedFiles ?? []).filter((f) => SENSITIVE.some((r) => r.test(f)));
}

/** 'smoke' when nothing that ships changed; 'full' otherwise or when unknown. */
export function laneFor(changedFiles) {
  if (!changedFiles || changedFiles.length === 0) return 'full';
  return changedFiles.every((f) => NOT_SHIPPED.some((r) => r.test(f))) ? 'smoke' : 'full';
}

/**
 * The URL prefix a changed page/route answers on, up to its first dynamic
 * segment — the flow tests call these addresses, so a substring match finds
 * the tests that exercise the change. null when the file isn't a screen.
 */
export function routeToken(file) {
  if (!file.startsWith('src/app/')) return null;
  let p = file.slice('src/app'.length);
  p = p.replace(/\/(page|route|layout|error|loading)\.[tj]sx?$/, '');
  p = p.replace(/\/\([^)]+\)/g, ''); // route groups don't appear in addresses
  const dyn = p.indexOf('/[');
  if (dyn >= 0) p = p.slice(0, dyn);
  return p || null;
}

/**
 * Which flow-test files to run first for this change. A changed flow test
 * runs; a changed screen pulls in every flow test that mentions its address.
 * A change to the shared test kit targets nothing (the full suite is next
 * anyway). flowTests: [{ name, source }].
 */
export function targetedFlowFiles(changedFiles, flowTests) {
  const picked = new Set();
  const tokens = new Set();
  for (const f of changedFiles ?? []) {
    if (/^tests\/flows\/(helpers|routes|global-setup)\.ts$/.test(f)) return [];
    const direct = f.match(/^tests\/flows\/([\w.-]+\.test\.ts)$/);
    if (direct) picked.add(direct[1]);
    const token = routeToken(f);
    if (token) tokens.add(token);
  }
  for (const { name, source } of flowTests) {
    if ([...tokens].some((t) => source.includes(t))) picked.add(name);
  }
  return [...picked].sort();
}

/**
 * How many times the computer went to sleep between two moments, read from
 * macOS's power log (`pmset -g log`). Lines look like:
 *   2026-10-04 17:28:09 -0400 Sleep   Entering Sleep state due to 'Clamshell Sleep':…
 */
export function sleepsDuring(pmsetLog, fromMs, toMs) {
  let count = 0;
  for (const line of String(pmsetLog ?? '').split('\n')) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})\s+Sleep\s+Entering Sleep/);
    if (!m) continue;
    const at = Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`);
    if (at >= fromMs && at <= toMs) count += 1;
  }
  return count;
}

/**
 * What a hot release's trailing check counts as "the change": everything
 * since the version it replaced, or, when that version's own trailing check
 * never came back clean, since the last one before it that did. Fix-forward
 * puts a fix live over a red release; the fix's check has to cover both, or a
 * fix that only touches a test would close the red with a smoke run.
 * hotRecord(sha): that release's hot record, or null if it took the full gate.
 * Returns { base, superseded } (superseded: the not-clean releases covered).
 */
export function trailingBase(prevSha, hotRecord) {
  let base = prevSha;
  const superseded = [];
  for (let i = 0; base && i < 50; i += 1) {
    const record = hotRecord(base);
    if (!record || record.trailing === 'pass' || !record.prevSha) break;
    superseded.push(base);
    base = record.prevSha;
  }
  return { base, superseded };
}

/** More failed files than this is not a blip: no second run. */
export const RERUN_AT_MOST = 3;

/**
 * What a failure that is the connection's doing looks like in vitest's
 * report: a request that never completed, a name that didn't resolve, or a
 * timeout (reported as STACK_TRACE_ERROR). Anything else, above all an
 * AssertionError or a "No matching email" from the test kit, is the test
 * saying the app did the wrong thing.
 */
const BLIP = /^(TypeError: fetch failed|Error: STACK_TRACE_ERROR|.*\b(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|UND_ERR_[A-Z_]+|socket hang up|timed out in \d+ ?ms)\b)/;

/** Is every failure in this file's report the connection's doing? (A file that failed with no failed test, a hook that timed out, counts.) */
export function looksLikeABlip(fileResult) {
  const failed = (Array.isArray(fileResult?.assertionResults) ? fileResult.assertionResults : []).filter((a) => a?.status === 'failed');
  return failed.every((a) => {
    const messages = Array.isArray(a.failureMessages) ? a.failureMessages : [];
    return messages.length > 0 && messages.every((m) => {
      const first = String(m).split('\n')[0].trim();
      return !first.startsWith('AssertionError') && BLIP.test(first);
    });
  });
}

/**
 * The flow-test files worth one more run after a failed stage, from vitest's
 * JSON report ({ testResults: [{ name: '/abs/file', status, assertionResults }] }):
 * the failed files, as paths inside the checkout, when there are only a few
 * of them and every failure in every one of them looks like a blip.
 * [] when nothing failed in a file (the run itself broke), when too many did,
 * when any failure is a real one (the stage has failed whatever a second run
 * says), or when the report can't be read.
 */
export function flowFilesToRerun(report, treeRoot) {
  const results = Array.isArray(report?.testResults) ? report.testResults : [];
  const root = String(treeRoot ?? '').replace(/\/+$/, '');
  const failed = [];
  for (const r of results) {
    if (r?.status !== 'failed' || typeof r.name !== 'string') continue;
    if (!looksLikeABlip(r)) return [];
    const at = r.name.indexOf('tests/flows/');
    if (at < 0 || (root && !r.name.startsWith(`${root}/`))) continue;
    const file = r.name.slice(at);
    if (/^tests\/flows\/[\w.-]+\.test\.ts$/.test(file) && !failed.includes(file)) failed.push(file);
  }
  return failed.length > 0 && failed.length <= RERUN_AT_MOST ? failed : [];
}
