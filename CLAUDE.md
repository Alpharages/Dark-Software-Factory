# AI Instructions — Dark Software Factory

## Package Manager

This project uses **pnpm** (v10.27+). Never use `npm` or `yarn`.

- Install dependencies: `pnpm install`
- Add a package: `pnpm add <package>`
- Add a dev package: `pnpm add -D <package>`
- Run scripts: `pnpm run <script>`

## Runtime

- Node.js ≥ 22
- TypeScript strict mode (all strict flags enabled)
- Target: ES2022

## Framework

NestJS 11 application. Follow NestJS conventions:

- Use decorators (`@Injectable()`, `@Controller()`, `@Module()`, etc.)
- Use dependency injection via constructor
- Use `@nestjs/config` ConfigService for environment configuration
- Use Prisma ORM for database access via `PrismaService`
- Import path alias: `@/*` maps to `src/*`

## Code Style

- Prettier: single quotes, trailing commas, 100 char print width, 2-space indent
- ESLint with `@typescript-eslint` rules
- Filenames: kebab-case (e.g., `my-feature.service.ts`)
- Test files: colocated with source as `*.spec.ts`
- Use `Logger` from `@nestjs/common` (not `console.log`)

## Database

- PostgreSQL via Prisma ORM
- Schema file: `prisma/schema.prisma`
- Migrations: `pnpm run db:migrate`
- After schema changes: `npx prisma generate`

## Testing

- Jest test runner
- Run tests: `pnpm test`
- Type check: `pnpm run typecheck`
- Lint: `pnpm run lint`
- Full check: `pnpm run check` (lint + test + build)

## Git

- Use `--no-verify` for commits (pre-commit hooks may not be available in CI)
- Branch naming: `feature/ticket-<id>`

## Project Structure

Key directories:

- `src/ai-routing/` — AI provider orchestration (Claude, Cursor)
- `src/ai-routing/providers/` — Individual AI provider implementations
- `src/database/` — Prisma service and database utilities
- `src/common/` — Shared utilities, guards, decorators
- `src/auth/` — Authentication (JWT)
- `src/projects/` — Project management
- `src/execution/` — Execution tracking and lifecycle
