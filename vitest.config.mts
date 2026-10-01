import { defineConfig } from 'vitest/config';

// Fast checks (`npm test`): pure logic only, no database or network.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
