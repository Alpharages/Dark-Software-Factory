# Contributing Guide

## Quick Reference

| Topic | Standard |
|-------|----------|
| Language | TypeScript (strict) |
| Package Manager | **pnpm** (not npm) |
| Framework | NestJS 11.x + Fastify |
| Database | PostgreSQL 16 + Prisma |
| Testing | Jest, >80% coverage |
| Formatting | Prettier |
| Linting | ESLint |

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
function process(ticket: TicketDto): Promise<Result> { }

// ✅ NestJS decorators
@Injectable()
export class TicketService {
  constructor(private readonly prisma: PrismaService) {}
}

// ✅ DTOs with validation
export class CreateTicketDto {
  @IsString() @MinLength(10)
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

## Security

- **Never commit secrets** - use `.env` (gitignored)
- **Run security check**: `pnpm audit`
- **No sensitive data in logs** - redact PII

## Architecture

See `docs/architecture.md` for:
- Module structure patterns
- Database schema
- API design conventions
