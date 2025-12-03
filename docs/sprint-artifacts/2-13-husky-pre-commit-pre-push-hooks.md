# Story 2.13: Husky Pre-Commit & Pre-Push Hooks

**Epic:** 2 - Ticket Intake & AI Routing Engine  
**Status:** ready-for-dev  
**Priority:** P0 - BLOCKER (for Epic 3)  
**Effort:** 3 story points  
**Created:** Epic 2 Retrospective (2025-12-04)

---

## Story

As a developer,
I want automated pre-commit and pre-push hooks that catch issues before code reaches review,
So that code review focuses on design and logic rather than mechanical issues.

---

## Background

This story was created during the Epic 2 retrospective based on the following learnings:

1. **Security issues slipped through to code review** — Command injection, missing auth guards, memory leaks
2. **Epic 1 committed to Husky hooks** — Action item was not fully implemented
3. **Automation over manual review** — Team principle established: if tools can catch it, tools should catch it

---

## Acceptance Criteria

**Given** the repository has Husky installed and configured  
**When** a developer attempts to commit code  
**Then** the following pre-commit checks run:
- `lint-staged` executes ESLint on staged `.ts` files
- `lint-staged` executes Prettier on staged `.ts`, `.json`, `.md` files
- Commit is blocked if any lint errors exist
- Warnings are shown but do not block

**And** when a developer attempts to push code  
**Then** the following pre-push checks run:
- `pnpm lint` — Full project linting
- `pnpm test` — Unit test suite
- Push is blocked if lint or tests fail

**And** ESLint security plugin is configured:
- `eslint-plugin-security` catches dangerous patterns
- Command injection patterns flagged (exec, spawn with user input)
- eval() and Function() usage flagged
- Prototype pollution patterns flagged

**And** the setup is documented:
- README.md updated with hook information
- CONTRIBUTING.md includes hook bypass instructions (for emergencies only)

---

## Technical Requirements

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `.husky/pre-commit` | CREATE | Pre-commit hook script |
| `.husky/pre-push` | CREATE | Pre-push hook script |
| `package.json` | MODIFY | Add lint-staged config, husky scripts |
| `.lintstagedrc.json` | CREATE | lint-staged configuration |
| `.eslintrc.js` | MODIFY | Add security plugin |
| `README.md` | MODIFY | Document hooks |
| `CONTRIBUTING.md` | MODIFY | Add bypass instructions |

### Dependencies to Install

```bash
pnpm add -D husky lint-staged eslint-plugin-security
```

### Implementation Steps

1. **Initialize Husky**
   ```bash
   pnpm exec husky init
   ```

2. **Create pre-commit hook** (`.husky/pre-commit`)
   ```bash
   #!/usr/bin/env sh
   . "$(dirname -- "$0")/_/husky.sh"
   
   pnpm exec lint-staged
   ```

3. **Create pre-push hook** (`.husky/pre-push`)
   ```bash
   #!/usr/bin/env sh
   . "$(dirname -- "$0")/_/husky.sh"
   
   pnpm lint && pnpm test
   ```

4. **Configure lint-staged** (`.lintstagedrc.json`)
   ```json
   {
     "*.ts": ["eslint --fix", "prettier --write"],
     "*.json": ["prettier --write"],
     "*.md": ["prettier --write"]
   }
   ```

5. **Add ESLint security plugin** (`.eslintrc.js`)
   ```javascript
   module.exports = {
     // ... existing config
     plugins: [
       // ... existing plugins
       'security'
     ],
     extends: [
       // ... existing extends
       'plugin:security/recommended'
     ],
     rules: {
       // Security rules
       'security/detect-child-process': 'error',
       'security/detect-eval-with-expression': 'error',
       'security/detect-non-literal-fs-filename': 'warn',
       'security/detect-object-injection': 'warn',
       'security/detect-possible-timing-attacks': 'warn',
     }
   };
   ```

6. **Update package.json scripts**
   ```json
   {
     "scripts": {
       "prepare": "husky"
     }
   }
   ```

---

## Definition of Done

- [ ] Husky initialized and hooks created
- [ ] Pre-commit hook runs lint-staged successfully
- [ ] Pre-push hook runs lint and tests successfully
- [ ] ESLint security plugin installed and configured
- [ ] All existing tests pass with new configuration
- [ ] Documentation updated (README.md, CONTRIBUTING.md)
- [ ] Team verified hooks work on their machines

---

## Bypass Instructions (Emergency Only)

For emergencies where hooks must be bypassed (with justification):

```bash
# Skip pre-commit hook
git commit --no-verify -m "message"

# Skip pre-push hook  
git push --no-verify
```

**Note:** All bypasses should be documented in PR description with justification.

---

## Success Metrics

After this story is complete:
- 100% of commits pass lint checks before reaching PR
- 100% of pushes pass tests before reaching remote
- Security patterns (command injection, eval) caught at commit time
- Code review can focus on design/logic, not formatting/linting
