import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    ignores: [
      '**/*.js',
      'node_modules/**/*',
      '.aws-sam/**/*',
      'coverage/**/*',
      '.prettierrc.cjs',
      'dist/**/*',
    ],
  },
  {
    // Node build scripts: typescript-eslint turns off `no-undef` for .ts files
    // because the compiler already checks it, but .mjs files get no such
    // override, so the Node globals they use must be declared.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    rules: {
      semi: 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
