# Story 2.15: ESLint Flat Config Migration

**Epic:** 2 - Ticket Intake & AI Routing Engine  
**Status:** done  
**Priority:** P2 - Low (Tech Debt)  
**Effort:** 1 story point  
**Created:** 2025-12-04 (Code Review of Story 2.14)

---

## Story

As a developer,
I want ESLint configured using the new flat config format (`eslint.config.mjs`),
So that we avoid deprecation warnings and ensure compatibility with ESLint v10+.

---

## Background

ESLint is deprecating the legacy `.eslintrc.*` configuration format. Support will be removed in ESLint v10.0.0.

**Current Setup:**

- `.eslintrc.js` - Legacy CommonJS format
- `ESLINT_USE_FLAT_CONFIG=false` - Env var forcing legacy mode in `package.json` and `.husky/pre-push`

---

## Acceptance Criteria

**AC1:** `pnpm lint` runs with no deprecation warnings about eslintrc configuration.

**AC2:** All existing lint rules preserved - same errors/warnings as before migration.

**AC3:** `pnpm exec lint-staged` (pre-commit) works without errors.

**AC4:** Pre-push hook runs ESLint without `ESLINT_USE_FLAT_CONFIG=false`.

**AC5:** CI/CD lint job passes without legacy config warnings.

---

## ⚠️ Critical: ESM Module Requirement

**The project uses CommonJS** (`"module": "commonjs"` in tsconfig.json, no `"type": "module"` in package.json).

**Solution:** Use `.mjs` extension for the flat config file. This forces Node.js to parse it as ESM while keeping the rest of the project as CommonJS.

```
✅ eslint.config.mjs  ← Use this (ESM module)
❌ eslint.config.js   ← Will fail (parsed as CommonJS)
```

---

## Files to Modify

| File                | Action                                      |
| ------------------- | ------------------------------------------- |
| `eslint.config.mjs` | **CREATE**                                  |
| `.eslintrc.js`      | **DELETE**                                  |
| `package.json`      | EDIT: Remove `ESLINT_USE_FLAT_CONFIG=false` |
| `.husky/pre-push`   | EDIT: Remove `ESLINT_USE_FLAT_CONFIG=false` |

**Unchanged:** `.github/workflows/ci.yml`, `.lintstagedrc.json`, `.husky/pre-commit`

---

## Tasks / Subtasks

- [x] **Task 1: Create `eslint.config.mjs`** (AC: 1, 2)
  - [x] Create flat config with ESM syntax and `.mjs` extension
  - [x] Add `files: ['**/*.ts']` to restrict TypeScript config to TS files
  - [x] Migrate TypeScript parser, rules, Prettier plugin, security plugin
  - [x] Configure ignore patterns

- [x] **Task 2: Update `package.json`** (AC: 1)
  - [x] Remove `ESLINT_USE_FLAT_CONFIG=false` from lint script

- [x] **Task 3: Update `.husky/pre-push`** (AC: 4)
  - [x] Remove `ESLINT_USE_FLAT_CONFIG=false`

- [x] **Task 4: Verify before deleting legacy config** (AC: 1-5)
  - [x] Run `node --input-type=module -e "import('./eslint.config.mjs')"` to verify ESM parsing
  - [x] Run `pnpm lint` - verify 0 errors, no deprecation warnings

- [x] **Task 5: Delete `.eslintrc.js`** (AC: 1)

---

## Implementation Guide

### Step 1: Create `eslint.config.mjs`

**File: `/eslint.config.mjs`** (project root - note `.mjs` extension)

```javascript
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
      '@typescript-eslint/interface-name-prefix': 'off',
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
);
```

### Step 2: Update `package.json`

```diff
- "lint": "ESLINT_USE_FLAT_CONFIG=false eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
+ "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
```

### Step 3: Update `.husky/pre-push`

```diff
  echo "Running pre-push checks..."
- ESLINT_USE_FLAT_CONFIG=false pnpm exec eslint "{src,apps,libs,test}/**/*.ts" --max-warnings=0 && pnpm test
+ pnpm exec eslint "{src,apps,libs,test}/**/*.ts" --max-warnings=0 && pnpm test
```

### Step 4: Verify & Delete

```bash
# Verify ESM module loads
node --input-type=module -e "import('./eslint.config.mjs')"

# Verify lint works
pnpm lint

# Delete legacy config
rm .eslintrc.js
```

---

## Dev Notes

### Why `.mjs` Extension?

- Project is CommonJS (`tsconfig.json`: `"module": "commonjs"`)
- No `"type": "module"` in `package.json`
- `.mjs` forces ESM parsing for this file only
- `import.meta.dirname` requires ESM (Node.js 20.11+, project uses Node 22 ✅)

### Dependencies (Already Installed)

All required packages exist in `package.json` devDependencies:

- `eslint` ^9.39.1, `@eslint/js` ^9.39.1, `typescript-eslint` ^8.48.0
- `eslint-config-prettier` ^10.1.8, `eslint-plugin-prettier` ^5.5.4
- `eslint-plugin-security` ^3.0.1, `globals` ^16.5.0

### Cross-Story Impact

**Story 3.1** references `.eslintrc` in acceptance criteria. After this migration, ESLint uses `eslint.config.mjs`. The `LinterService` implementation should auto-detect config format (ESLint CLI handles this automatically).

### Validation Commands

```bash
pnpm lint 2>&1 | grep -i "deprecated"  # Should return nothing
pnpm lint                               # Should return 0 errors
pnpm exec eslint "{src,apps,libs,test}/**/*.ts" --max-warnings=0
```

---

## References

- [ESLint Migration Guide](https://eslint.org/docs/latest/use/configure/migration-guide)
- [typescript-eslint Flat Config](https://typescript-eslint.io/getting-started#step-2-configuration)

---

## Dev Agent Record

### File List

**Create:** `eslint.config.mjs`
**Modify:** `package.json`, `.husky/pre-push`
**Delete:** `.eslintrc.js`

### Change Log

| Date       | Change                                                                                                                             | Author             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 2025-12-04 | Story created from code review finding                                                                                             | Code Review        |
| 2025-12-04 | Enhanced with implementation guide                                                                                                 | SM Agent           |
| 2025-12-04 | Quality review: Fixed ESM/CommonJS conflict (use .mjs), added files property, added prettier plugin, documented cross-story impact | QA Validator       |
| 2025-12-04 | **IMPLEMENTED**: Created eslint.config.mjs, updated package.json and pre-push, deleted .eslintrc.js. All 5 ACs verified.           | Amelia (Dev Agent) |
| 2025-12-04 | **CODE REVIEW**: All 5 ACs PASS. Fixed M1: Removed obsolete `@typescript-eslint/interface-name-prefix` rule.                       | Code Review        |

---

## Status

**Status:** done
