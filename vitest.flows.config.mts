import { defineConfig } from 'vitest/config';

// Flow tests (`npm run test:flows`): whole business flows against the test
// copy. Run them with the test copy's settings:
//   railway run --service "StoryVenue Backend" --environment Dev -- npm run test:flows
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/flows/**/*.test.ts'],
    // Quiet mode: no email leaves the test copy while the tests run.
    globalSetup: ['tests/flows/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    // One shared owner session across files (sign-in is rate limited).
    isolate: false,
  },
});
