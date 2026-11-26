import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/server/**/*.test.ts', 'tests/scripts/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
