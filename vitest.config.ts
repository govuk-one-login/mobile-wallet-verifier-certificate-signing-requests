import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.{test,spec,steps}.?(c|m)[jt]s?(x)'],
    env: {
      POWERTOOLS_DEV: 'true',
      POWERTOOLS_LOG_LEVEL: 'DEBUG',
    },
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        '**/*.test.ts',
        'vitest.config.ts',
        'eslint.config.ts',
        'tests/**',
        'src/**/tests/utils/**',
        'src/utils/test/**',
      ],
    },
    setupFiles: ['vitest.setup.ts'],
  },
});
