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
 */

/** Paths that never ship with the app. */
const NOT_SHIPPED = [/^scripts\//, /^tests\//, /^docs\//, /^\.claude\//, /^\.gitignore$/, /\.md$/i];

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
