#!/usr/bin/env node
/**
 * Put the previous version back live, in about a minute: re-activates the
 * deployment a hot release recorded before it went out (no rebuild, nothing
 * deleted — the newer code stays on main; fix it and release again).
 *
 *   node scripts/staging/rollback.mjs <hot sha>
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const sha = git('rev-parse', process.argv[2] || 'HEAD');
const hotFile = join(git('rev-parse', '--git-dir'), 'storyvenue-checks', `hot-${sha}.json`);
if (!existsSync(hotFile)) {
  console.error(`No hot release record for ${sha.slice(0, 8)} (${hotFile}).`);
  process.exit(1);
}
const hot = JSON.parse(readFileSync(hotFile, 'utf8'));
console.log(`Rolling production back to ${String(hot.prevSha).slice(0, 8)} (deployment ${hot.prevDeploymentId})…`);
const out = execFileSync('npx', ['-y', '@railway/cli@5.63.1', 'api',
  `mutation { deploymentRollback(id: "${hot.prevDeploymentId}") }`,
], { encoding: 'utf8', env: { ...process.env, RAILWAY_CALLER: 'skill:use-railway@1.5.5' } });
console.log(out.trim());
const ok = !/"errors"|error/i.test(out);
writeFileSync(hotFile, JSON.stringify({ ...hot, rolledBack: ok, rolledBackAt: new Date().toISOString() }, null, 1));
console.log(ok
  ? `Production is going back to ${String(hot.prevSha).slice(0, 8)}. The newer code stays on main — fix and release again.`
  : 'ROLLBACK DID NOT CONFIRM — check Railway now (StoryVenue Backend, production).');
process.exit(ok ? 0 : 1);
