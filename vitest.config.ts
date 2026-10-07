import { defineConfig } from 'vitest/config';

const sharedEnv = {
  POWERTOOLS_DEV: 'true',
  POWERTOOLS_LOG_LEVEL: 'DEBUG',
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'infra',
          include: [
            'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
            'tests/infraTests/**/*.{test,spec,steps}.?(c|m)[jt]s?(x)',
          ],
          env: sharedEnv,
          environment: 'node',
          setupFiles: ['vitest.setup.ts'],
        },
      },
      {
        test: {
          name: 'system',
          include: ['tests/systemTests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
          env: sharedEnv,
          environment: 'node',
          setupFiles: ['vitest.setup.ts'],
        },
      },
      {
        test: {
          name: 'unit',
          env: sharedEnv,
          include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
          exclude: ['node_modules/**'],
          setupFiles: ['vitest.setup.ts'],
        },
      },
      {
        test: {
          name: 'script-unit',
          clearMocks: true,
          include: ['scripts/unit/**/*.test.ts'],
          exclude: ['node_modules/**'],
          setupFiles: ['./scripts/unit/test-setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'scripts/lib/**/*.ts'],
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        '**/*.test.ts',
        'vitest.config.ts',
        'eslint.config.ts',
        'tests/**',
        'scripts/unit/**',
        'scripts/lib/verify-csr/types.ts',
        'src/**/tests/utils/**',
        'src/utils/test/**',
      ],
    },
  },
});
