import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/test.ts',
        'src/server.ts', // Tested via E2E, not unit coverage
      ],
      thresholds: {
        statements: 90,
        branches: 80, // Lower for error handling branches in sentinel epics
        functions: 90,
        lines: 90,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
