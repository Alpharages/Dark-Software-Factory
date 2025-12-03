# Contributing Guide

## Quick Reference

| Topic           | Standard               |
| --------------- | ---------------------- |
| Language        | TypeScript (strict)    |
| Package Manager | **pnpm** (not npm)     |
| Framework       | NestJS 11.x + Fastify  |
| Database        | PostgreSQL 16 + Prisma |
| Testing         | Jest, >80% coverage    |
| Formatting      | Prettier               |
| Linting         | ESLint                 |

## Workflow

```bash
# 1. Branch from main
git checkout -b feature/DSF-XXX-description

# 2. Make changes with tests

# 3. Quality check
pnpm run check  # lint + test + build

# 4. Commit (Conventional Commits)
git commit -m "feat(module): description"

# 5. Push & create PR
git push origin feature/DSF-XXX-description
```

## Commit Format

```
type(scope): description

Types: feat|fix|docs|style|refactor|test|perf|chore
```

Examples:

- `feat(auth): add JWT refresh tokens`
- `fix(db): correct migration order`
- `docs(readme): update setup instructions`

## Code Style

```typescript
// ✅ Explicit types
function process(ticket: TicketDto): Promise<Result> {}

// ✅ NestJS decorators
@Injectable()
export class TicketService {
  constructor(private readonly prisma: PrismaService) {}
}

// ✅ DTOs with validation
export class CreateTicketDto {
  @IsString()
  @MinLength(10)
  title: string;
}
```

## Testing

**>80% coverage required**

```bash
pnpm run test        # Run tests
pnpm run test:cov    # Coverage report
```

## PR Checklist

- [ ] Tests pass: `pnpm run test`
- [ ] Coverage >80%: `pnpm run test:cov`
- [ ] Lint passes: `pnpm run lint`
- [ ] Build succeeds: `pnpm run build`
- [ ] ClickUp task linked

## Git Hooks

This project uses Husky for automated pre-commit and pre-push checks.

| Hook         | What Runs                                       | Blocked If                   |
| ------------ | ----------------------------------------------- | ---------------------------- |
| `pre-commit` | lint-staged (ESLint + Prettier on staged files) | Lint errors                  |
| `pre-push`   | Full lint + all tests                           | Lint errors or test failures |

### Bypassing Hooks (Emergency Only)

⚠️ **Use only in genuine emergencies** - all bypasses must be documented in PR description.

```bash
# Skip pre-commit hook
git commit --no-verify -m "fix: emergency hotfix"

# Skip pre-push hook
git push --no-verify
```

**When bypass is acceptable:**

- Critical hotfix that can't wait for full test suite
- Known flaky test blocking urgent deployment
- Build system issue unrelated to code changes

**When bypass is NOT acceptable:**

- "I don't have time to fix the lint errors"
- "The tests are slow"
- "I'll fix it later"

## Security

- **Never commit secrets** - use `.env` (gitignored)
- **Run security check**: `pnpm audit`
- **No sensitive data in logs** - redact PII
- **ESLint security plugin** - enabled to catch command injection, eval, and prototype pollution

## Architecture

See `docs/architecture.md` for:

- Module structure patterns
- Database schema
- API design conventions
