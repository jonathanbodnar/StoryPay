/**
 * Node-only startup for the test copy (called from instrumentation.ts): exit
 * on live settings, then switch on the catch-all. See src/lib/staging.ts.
 */

import { installStagingFetchGuard, isStaging, stagingConfigProblems } from '@/lib/staging';

export function prepareStaging(): void {
  if (!isStaging()) return;
  const problems = stagingConfigProblems();
  if (problems.length) {
    // Exit, not throw: Next keeps a failed server up and answers every
    // request with a 500, which would look healthy on Railway.
    console.error(`[staging] The test copy refuses to start with live settings: ${problems.join('; ')}`);
    process.exit(1);
  }
  installStagingFetchGuard();
}
