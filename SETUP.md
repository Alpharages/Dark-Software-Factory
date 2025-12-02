# Setup Guide

> Target: Working environment in **under 1 hour**

## Prerequisites

| Software | Version | Verify |
|----------|---------|--------|
| Node.js | 20.x LTS | `node -v` |
| pnpm | 9.x+ | `pnpm -v` |
| Docker | Latest | `docker -v` |
| Docker Compose | v2+ | `docker compose version` |

```bash
# Verify all at once
pnpm run check:versions
```

## Quick Start (Docker)

```bash
# Clone & install
git clone https://github.com/alpharages/dark-software-factory.git
cd dark-software-factory
pnpm install

# Environment setup
cp .env.example .env
# Edit .env: Generate JWT_SECRET with: openssl rand -base64 32

# Start services & database
docker compose up -d
pnpm run db:generate
pnpm run db:migrate:deploy

# Start dev server
pnpm run start:dev

# Verify
curl http://localhost:3000/health
open http://localhost:3000/api/docs
```

## Environment Variables

**Required** (minimum for local dev):
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_orchestrator?schema=public"
RABBITMQ_URL="amqp://guest:guest@localhost:5672"
JWT_SECRET="<generate with: openssl rand -base64 32>"
AUTH_SERVICE_URL="http://localhost:3001"
```

See `.env.example` for all variables.

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `pnpm run start:dev` | Development with hot reload |
| `pnpm run test` | Unit tests |
| `pnpm run test:cov` | Coverage report |
| `pnpm run lint` | ESLint check & fix |
| `pnpm run db:migrate:deploy` | Apply migrations |
| `pnpm run db:studio` | Prisma GUI |
| `pnpm run docker:up` | Start Docker services |
| `pnpm run check` | Full quality check |

## Troubleshooting

**"Cannot connect to database"**
```bash
docker compose ps  # Check postgres is healthy
docker compose up -d postgres
```

**"Prisma client not generated"**
```bash
pnpm run db:generate
```

**"JWT_SECRET validation error"**
```bash
openssl rand -base64 32  # Generate & add to .env
```

**"Port 3000 in use"**
```bash
lsof -i :3000 && kill -9 <PID>
```

## Utility Scripts

Shell scripts in `scripts/` folder:
- `generate-modules.sh` - NestJS module scaffolding
- `validate-ai-providers.sh` - Validate AI provider configuration
- `validate-cursor-headless.sh` - Validate Cursor headless setup

## Next Steps

1. Read `docs/architecture.md`
2. Explore API: http://localhost:3000/api/docs
3. See `CONTRIBUTING.md` for development guidelines
