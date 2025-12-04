import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginPrettier from 'eslint-plugin-prettier';
import eslintPluginSecurity from 'eslint-plugin-security';
import globals from 'globals';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'prisma/migrations/**',
      '**/*.config.js',
      '**/*.config.mjs',
    ],
  },

  // Base ESLint recommended
  eslint.configs.recommended,

  // TypeScript-ESLint recommended
  ...tseslint.configs.recommended,

  // Prettier (disables conflicting rules)
  eslintConfigPrettier,

  // TypeScript files configuration
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      security: eslintPluginSecurity,
      prettier: eslintPluginPrettier,
    },
    rules: {
      // Prettier auto-fix
      'prettier/prettier': 'error',

      // TypeScript rules
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Security rules
      'security/detect-child-process': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-object-injection': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
    },
  },

  // Security utility files - these ARE the security implementation layer
  // They must perform the underlying operations that trigger security warnings
  // The security is provided by validation functions (validatePath, hasOwnProperty checks)
  {
    files: ['**/common/utils/safe-*.util.ts'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
    },
  },

  // Test files - mock objects and test fixtures use dynamic property access
  // These patterns are safe in test context where data is controlled
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      'security/detect-object-injection': 'off',
    },
  },
);
