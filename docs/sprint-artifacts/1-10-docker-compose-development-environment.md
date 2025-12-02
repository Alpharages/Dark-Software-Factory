# Story 1.10: Docker Compose Development Environment

**Epic:** 1 - Foundation & Development Environment  
**Status:** ready-for-dev  
**Priority:** P1 - HIGH (Required for consistent local development environment)  
**Effort:** 5 story points  
**ClickUp ID:** `86evnjw8x`  
**ClickUp URL:** https://app.clickup.com/t/86evnjw8x

---

## ⚠️ CRITICAL ARCHITECTURE NOTES

**Current State:**
- `docker-compose.yml` EXISTS with PostgreSQL 16 and RabbitMQ 3.13 services (from Stories 1.3 and 1.5)
- **NO** Dockerfile or Dockerfile.dev exists
- The orchestrator app service is **NOT** yet included in docker-compose.yml
- Hot reload development mode is NOT configured for Docker

**This Story COMPLETES:**
1. Add orchestrator app service to docker-compose.yml with hot reload
2. Create `Dockerfile.dev` for development builds
3. Create `Dockerfile` for production builds (future use)
4. Add proper health checks for all services
5. Configure networking between services
6. Add prometheus + grafana services (optional, for monitoring stack)
7. Update README with Docker development instructions

**Integration with Previous Stories:**
- Story 1.3 (PostgreSQL): Database connection via `DATABASE_URL`
- Story 1.4 (Configuration): Environment variables in docker-compose
- Story 1.5 (RabbitMQ): Message queue connection via `RABBITMQ_URL`

---

## Quick Implementation Reference (Expert Mode)

```bash
# 1. Create docker directory structure
mkdir -p docker

# 2. Create files (5 files total)
# - docker/Dockerfile.dev
# - docker/Dockerfile
# - docker/docker-compose.yml (replaces root docker-compose.yml)
# - .dockerignore (at PROJECT ROOT - important!)
# - docker/prometheus.yml (optional, for monitoring)

# 3. Create root symlink for convenience (optional)
ln -sf docker/docker-compose.yml docker-compose.yml

# 4. Start development environment
docker-compose up -d

# 5. Run initial database migration (REQUIRED on first start)
docker-compose exec app npx prisma migrate deploy

# 6. Verify all services healthy
docker-compose ps
docker-compose logs -f app

# 7. Run tests against containerized services
npm run test:e2e
```

---

## Story

As a developer,
I want a Docker Compose setup for local development,
So that I can run PostgreSQL, RabbitMQ, and the orchestrator together easily.

---

## Acceptance Criteria

**Given** Docker and Docker Compose are installed  
**When** I run `docker-compose up`  
**Then** the following services start:
- PostgreSQL 16 on port 5432 with persistent volume
- RabbitMQ 3.13-management on port 5672 (AMQP) and 15672 (UI)
- Orchestrator application on port 3000 (dev mode with hot reload)

**And** services are networked (orchestrator can reach PostgreSQL and RabbitMQ)
**And** data persists across container restarts (volumes mounted)
**And** RabbitMQ management UI is accessible at http://localhost:15672
**And** Application logs stream to console in real-time

**Additional Acceptance:**
- Health checks pass for all services before dependent services start
- Hot reload works when source files change (volume mounting)
- `docker-compose down` cleanly stops all services
- `docker-compose down -v` removes volumes for fresh start
- Database migrations can run inside container

---

## Technical Requirements

### Quick Reference: Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `docker/Dockerfile.dev` | CREATE | Development image with hot reload |
| `docker/Dockerfile` | CREATE | Production image (multi-stage) |
| `docker/docker-compose.yml` | CREATE | Complete development stack |
| `.dockerignore` (PROJECT ROOT) | CREATE | Ignore patterns for Docker builds |
| `docker/prometheus.yml` | CREATE | Prometheus scrape config (optional) |
| `docker-compose.yml` (root) | MODIFY | Symlink or replace with full config |
| `README.md` | MODIFY | Add Docker development instructions |
| `.env.example` | MODIFY | Add Docker-specific environment variables |
| `package.json` | MODIFY | Add Docker-related npm scripts |

---

### Step 1: Create Docker Directory Structure

```bash
mkdir -p docker
```

---

### Step 2: Create .dockerignore

**File:** `.dockerignore` (at PROJECT ROOT, not in docker/ folder)

**⚠️ IMPORTANT:** Docker looks for `.dockerignore` relative to the build context. Since docker-compose.yml uses `context: ..` (project root), the `.dockerignore` must be at the **project root**, not inside the docker/ folder.

```dockerignore
# Dependencies
node_modules
npm-debug.log
yarn-debug.log
yarn-error.log

# Build outputs
dist
coverage
.nyc_output

# IDE and editors
.idea
.vscode
*.swp
*.swo

# Git
.git
.gitignore
.gitattributes

# Docker (prevent recursive copy)
docker
Dockerfile*
docker-compose*

# Environment files (use env vars instead)
.env
.env.local
.env.*.local

# Documentation (not needed in container)
docs
*.md
!README.md

# Tests (for production image)
test
*.spec.ts
*.test.ts
jest.config.*
jest-e2e.json

# Misc
.DS_Store
*.log
tmp
temp
```

---

### Step 3: Create Development Dockerfile

**File:** `docker/Dockerfile.dev`

```dockerfile
# ===========================================
# Dark Software Factory - Development Image
# ===========================================
# Purpose: Local development with hot reload
# Usage: docker-compose up (not standalone)
# ===========================================

FROM node:22-alpine AS development

# Set working directory
WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++ git

# Install pnpm (project uses pnpm)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml ./

# Install ALL dependencies (including devDependencies for development)
RUN pnpm install --frozen-lockfile

# Copy Prisma schema for client generation
COPY prisma ./prisma/

# Generate Prisma client
RUN npx prisma generate

# Copy source code (will be overwritten by volume mount in docker-compose)
COPY . .

# Expose application port
EXPOSE 3000

# Development command with hot reload
# Note: --watch uses native Node.js file watcher
CMD ["pnpm", "run", "start:dev"]
```

---

### Step 4: Create Production Dockerfile (Multi-Stage)

**File:** `docker/Dockerfile`

**Note:** This production Dockerfile is provided as a preview for Story 1.11 (GitHub Actions CI/CD Pipeline). It's created now to ensure the complete Docker setup is in place.

```dockerfile
# ===========================================
# Dark Software Factory - Production Image
# ===========================================
# Purpose: Optimized production deployment
# Multi-stage build for minimal image size
# Used by: Story 1.11 (CI/CD Pipeline)
# ===========================================

# ---- Dependencies Stage ----
FROM node:22-alpine AS dependencies

WORKDIR /app

# Install build tools for native modules
RUN apk add --no-cache python3 make g++

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# ---- Build Stage ----
FROM node:22-alpine AS build

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install ALL dependencies (need devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy Prisma schema
COPY prisma ./prisma/

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# ---- Production Stage ----
FROM node:22-alpine AS production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

WORKDIR /app

# Copy built artifacts from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

# Copy production dependencies from dependencies stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy package.json for script access
COPY package.json ./

# Generate Prisma client for production
RUN npx prisma generate

# Set ownership to non-root user
RUN chown -R nestjs:nodejs /app

# Switch to non-root user
USER nestjs

# Expose application port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

# Production command
CMD ["node", "dist/main.js"]
```

---

### Step 5: Create Complete Docker Compose Configuration

**File:** `docker/docker-compose.yml`

```yaml
# ===========================================
# Dark Software Factory - Development Stack
# ===========================================
# Usage:
#   Start:     docker-compose up -d
#   Logs:      docker-compose logs -f
#   Stop:      docker-compose down
#   Clean:     docker-compose down -v
# ===========================================

name: dark-software-factory  # Explicit project name prevents conflicts

services:
  # ===========================================
  # PostgreSQL Database
  # ===========================================
  postgres:
    image: postgres:16-alpine
    container_name: dsf-postgres
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-ai_orchestrator}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-ai_orchestrator}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    networks:
      - dsf-network
    restart: unless-stopped

  # ===========================================
  # RabbitMQ Message Queue
  # ===========================================
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    container_name: dsf-rabbitmq
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-guest}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASS:-guest}
      RABBITMQ_DEFAULT_VHOST: ${RABBITMQ_VHOST:-/}
    ports:
      - "${RABBITMQ_PORT:-5672}:5672"      # AMQP protocol
      - "${RABBITMQ_MGMT_PORT:-15672}:15672"  # Management UI
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks:
      - dsf-network
    restart: unless-stopped

  # ===========================================
  # AI Dev Orchestrator Application
  # ===========================================
  app:
    build:
      context: ..
      dockerfile: docker/Dockerfile.dev
    container_name: dsf-app
    environment:
      # Application
      NODE_ENV: development
      PORT: 3000
      
      # Hot reload (required for macOS Docker file watching)
      WATCHPACK_POLLING: "true"
      CHOKIDAR_USEPOLLING: "true"
      
      # Database (connects to postgres service)
      DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@postgres:5432/${POSTGRES_DB:-ai_orchestrator}?schema=public
      
      # RabbitMQ (connects to rabbitmq service)
      RABBITMQ_URL: amqp://${RABBITMQ_USER:-guest}:${RABBITMQ_PASS:-guest}@rabbitmq:5672
      
      # JWT (use development secret)
      JWT_SECRET: ${JWT_SECRET:-dev-secret-change-in-production}
      JWT_EXPIRATION: ${JWT_EXPIRATION:-3600}
      
      # AI Providers (optional for development)
      CURSOR_API_KEY: ${CURSOR_API_KEY:-}
      WINDSURF_API_KEY: ${WINDSURF_API_KEY:-}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      
      # GitHub (optional for development)
      GITHUB_APP_ID: ${GITHUB_APP_ID:-}
      GITHUB_APP_PRIVATE_KEY: ${GITHUB_APP_PRIVATE_KEY:-}
      
      # ClickUp (optional for development)
      CLICKUP_WEBHOOK_SECRET: ${CLICKUP_WEBHOOK_SECRET:-}
      
      # Sentry (optional for development)
      SENTRY_DSN: ${SENTRY_DSN:-}
    ports:
      - "${APP_PORT:-3000}:3000"
    volumes:
      # Mount source code for hot reload
      - ../src:/app/src:delegated
      - ../prisma:/app/prisma:delegated
      - ../test:/app/test:delegated
      # Mount config files
      - ../package.json:/app/package.json:ro
      - ../tsconfig.json:/app/tsconfig.json:ro
      - ../nest-cli.json:/app/nest-cli.json:ro
      # Exclude node_modules (use container's node_modules)
      - /app/node_modules
      # Exclude dist (build output)
      - /app/dist
    depends_on:
      postgres:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    networks:
      - dsf-network
    restart: unless-stopped
    # Resource limits (prevents OOM during Prisma generate)
    deploy:
      resources:
        limits:
          memory: 2G
        reservations:
          memory: 512M
    # Log rotation (prevents unbounded log growth)
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  # ===========================================
  # Prometheus (Optional - Metrics)
  # ===========================================
  prometheus:
    image: prom/prometheus:v2.48.1
    container_name: dsf-prometheus
    profiles:
      - monitoring
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_data:/prometheus
    ports:
      - "${PROMETHEUS_PORT:-9090}:9090"
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/usr/share/prometheus/console_libraries'
      - '--web.console.templates=/usr/share/prometheus/consoles'
      - '--web.enable-lifecycle'
    networks:
      - dsf-network
    restart: unless-stopped

  # ===========================================
  # Grafana (Optional - Dashboards)
  # ===========================================
  grafana:
    image: grafana/grafana:10.2.3
    container_name: dsf-grafana
    profiles:
      - monitoring
    environment:
      GF_SECURITY_ADMIN_USER: ${GRAFANA_USER:-admin}
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD:-admin}
      GF_USERS_ALLOW_SIGN_UP: false
    volumes:
      - grafana_data:/var/lib/grafana
    ports:
      - "${GRAFANA_PORT:-3001}:3000"
    depends_on:
      - prometheus
    networks:
      - dsf-network
    restart: unless-stopped

# ===========================================
# Networks
# ===========================================
networks:
  dsf-network:
    driver: bridge
    name: dsf-network

# ===========================================
# Volumes
# ===========================================
volumes:
  postgres_data:
    driver: local
    name: dsf-postgres-data
  rabbitmq_data:
    driver: local
    name: dsf-rabbitmq-data
  prometheus_data:
    driver: local
    name: dsf-prometheus-data
  grafana_data:
    driver: local
    name: dsf-grafana-data
```

---

### Step 6: Create Prometheus Configuration (Optional)

**File:** `docker/prometheus.yml`

```yaml
# Prometheus configuration for Dark Software Factory
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  # Prometheus self-monitoring
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  # AI Dev Orchestrator metrics
  - job_name: 'dsf-app'
    static_configs:
      - targets: ['app:3000']
    metrics_path: '/metrics'
    scrape_interval: 10s
```

---

### Step 7: Update Root docker-compose.yml

**Option A: Replace root file with symlink (recommended)**

```bash
# Remove old docker-compose.yml
rm docker-compose.yml

# Create symlink to docker/docker-compose.yml
ln -s docker/docker-compose.yml docker-compose.yml
```

**Option B: Replace root file with updated content**

Replace `/Volumes/Data/project/products/alpharages/Dark Software Factory/docker-compose.yml` with the content from Step 5.

---

### Step 8: Update package.json with Docker Scripts

Add these scripts to `package.json`:

```json
{
  "scripts": {
    // ... existing scripts ...
    
    "docker:up": "docker-compose up -d",
    "docker:down": "docker-compose down",
    "docker:logs": "docker-compose logs -f",
    "docker:logs:app": "docker-compose logs -f app",
    "docker:clean": "docker-compose down -v",
    "docker:rebuild": "docker-compose build --no-cache",
    "docker:shell": "docker-compose exec app sh",
    "docker:migrate": "docker-compose exec app npx prisma migrate dev",
    "docker:seed": "docker-compose exec app npx prisma db seed",
    "docker:studio": "docker-compose exec app npx prisma studio",
    "docker:monitoring": "docker-compose --profile monitoring up -d"
  }
}
```

---

### Step 9: Update .env.example

Add Docker-specific environment variables to `.env.example`:

```bash
# ========================================
# Docker Development Environment (Story 1.10)
# ========================================

# PostgreSQL Container
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=ai_orchestrator
POSTGRES_PORT=5432

# RabbitMQ Container
RABBITMQ_USER=guest
RABBITMQ_PASS=guest
RABBITMQ_VHOST=/
RABBITMQ_PORT=5672
RABBITMQ_MGMT_PORT=15672

# Application Container
APP_PORT=3000

# Monitoring Stack (optional)
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001
GRAFANA_USER=admin
GRAFANA_PASSWORD=admin
```

---

### Step 10: Update README.md with Docker Instructions

Add this section to the README.md:

```markdown
## Docker Development Environment

### Prerequisites

- Docker 24+ and Docker Compose v2
- 4GB+ RAM allocated to Docker

### Quick Start

```bash
# Start all services (PostgreSQL, RabbitMQ, App)
docker-compose up -d

# ⚠️ IMPORTANT: Run initial migration after FIRST start
docker-compose exec app npx prisma migrate deploy

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Clean restart (removes volumes)
docker-compose down -v && docker-compose up -d
```

### Available Services

| Service | Port | URL | Description |
|---------|------|-----|-------------|
| App | 3000 | http://localhost:3000 | AI Dev Orchestrator |
| PostgreSQL | 5432 | - | Database |
| RabbitMQ | 5672 | - | Message Queue |
| RabbitMQ UI | 15672 | http://localhost:15672 | Management (guest/guest) |

### Optional Monitoring Stack

```bash
# Start with Prometheus + Grafana
docker-compose --profile monitoring up -d
```

| Service | Port | URL | Credentials |
|---------|------|-----|-------------|
| Prometheus | 9090 | http://localhost:9090 | - |
| Grafana | 3001 | http://localhost:3001 | admin/admin |

### Common Commands

```bash
# Run database migrations
npm run docker:migrate

# Seed database
npm run docker:seed

# Open Prisma Studio
npm run docker:studio

# Shell into app container
npm run docker:shell

# Rebuild containers
npm run docker:rebuild
```

### Hot Reload

Source code changes are automatically detected. The app restarts within 2-3 seconds.

### Troubleshooting

**Container won't start:**
```bash
# Check logs
docker-compose logs app

# Verify health checks
docker-compose ps

# Rebuild from scratch
docker-compose down -v
docker-compose build --no-cache
docker-compose up -d
```

**Database connection failed:**
```bash
# Ensure postgres is healthy
docker-compose exec postgres pg_isready

# Check DATABASE_URL
docker-compose exec app printenv | grep DATABASE
```

**RabbitMQ connection failed:**
```bash
# Ensure rabbitmq is healthy
docker-compose exec rabbitmq rabbitmq-diagnostics ping

# Check management UI
open http://localhost:15672
```

**Network connectivity issues:**
```bash
# Inspect Docker network
docker network inspect dsf-network

# Test connectivity from app container
docker-compose exec app sh -c "ping -c 3 postgres"
docker-compose exec app sh -c "ping -c 3 rabbitmq"

# Check DNS resolution
docker-compose exec app sh -c "nslookup postgres"
```
```

---

## Testing Configuration

### Manual Verification Checklist

```bash
# 1. Start all services
docker-compose up -d

# 2. Run initial database migration (REQUIRED on first start)
docker-compose exec app npx prisma migrate deploy
# Expected: Migrations applied successfully

# 3. Verify all containers are running and healthy
docker-compose ps
# Expected: All services "healthy" or "running"

# 4. Test PostgreSQL connection
docker-compose exec postgres psql -U postgres -d ai_orchestrator -c "SELECT 1;"
# Expected: Returns "1"

# 5. Test RabbitMQ connection
docker-compose exec rabbitmq rabbitmq-diagnostics ping
# Expected: "Ping succeeded"

# 6. Test App health endpoint
curl http://localhost:3000/health
# Expected: 200 OK with health status

# 7. Test RabbitMQ Management UI
curl -u guest:guest http://localhost:15672/api/overview
# Expected: JSON with cluster info

# 8. Test hot reload
# Edit any file in src/
# Watch logs: docker-compose logs -f app
# Expected: App restarts automatically

# 9. Test database migration status in container
docker-compose exec app npx prisma migrate status
# Expected: Shows migration status

# 10. Clean shutdown
docker-compose down
# Expected: All containers stop gracefully

# 11. Volume persistence test
docker-compose up -d
docker-compose exec postgres psql -U postgres -d ai_orchestrator -c "CREATE TABLE test_persist (id INT);"
docker-compose down
docker-compose up -d
docker-compose exec postgres psql -U postgres -d ai_orchestrator -c "SELECT * FROM test_persist;"
# Expected: Table exists (data persisted)
docker-compose exec postgres psql -U postgres -d ai_orchestrator -c "DROP TABLE test_persist;"
```

---

## Validation Checklist

**Docker Files Created:**
- [x] `docker/Dockerfile.dev` - Development image with hot reload
- [x] `docker/Dockerfile` - Production multi-stage image
- [x] `docker/docker-compose.yml` - Complete development stack
- [x] `.dockerignore` (at PROJECT ROOT) - Build exclusions
- [x] `docker/prometheus.yml` - Prometheus configuration (optional)

**Services Configured:**
- [x] PostgreSQL 16 with health check and volume
- [x] RabbitMQ 3.13-management with health check and volume
- [x] App service with hot reload via volume mounts
- [x] Prometheus + Grafana (optional, via profile)

**Networking:**
- [x] All services on `dsf-network`
- [x] App can connect to postgres via hostname `postgres`
- [x] App can connect to rabbitmq via hostname `rabbitmq`

**Health Checks:**
- [x] PostgreSQL: `pg_isready` command
- [x] RabbitMQ: `rabbitmq-diagnostics ping` command
- [x] App: HTTP GET /health endpoint

**Volume Mounts (Hot Reload):**
- [x] `src/` mounted for source code changes
- [x] `prisma/` mounted for schema changes
- [x] `test/` mounted for test changes
- [x] `node_modules/` excluded (use container's)

**Environment Variables:**
- [x] DATABASE_URL points to postgres service
- [x] RABBITMQ_URL points to rabbitmq service
- [x] All variables have defaults for development

**Documentation:**
- [x] README.md updated with Docker instructions
- [x] .env.example updated with Docker variables
- [x] package.json has docker:* scripts

**Resource Limits:**
- [x] App container has memory limit (2G)
- [x] Log rotation configured (max 10m, 3 files)
- [x] WATCHPACK_POLLING enabled for macOS hot reload

**Tests:**
- [x] All services start with `docker-compose up -d`
- [x] Initial migration runs: `docker-compose exec app npx prisma migrate deploy`
- [x] Health checks pass (green in `docker-compose ps`)
- [x] Hot reload works when editing src/ files
- [x] Database migrations run in container
- [x] Data persists across container restarts
- [x] Clean shutdown with `docker-compose down`

---

## File List

### Created
- `docker/Dockerfile.dev`
- `docker/Dockerfile`
- `docker/docker-compose.yml`
- `docker/prometheus.yml`
- `.dockerignore`

### Modified
- `docker-compose.yml` (Symlinked to `docker/docker-compose.yml`)
- `package.json`
- `.env.example`
- `README.md`

## Change Log

### 2025-12-02
- Created `docker` directory structure
- Implemented `Dockerfile.dev` for development with hot reload
- Implemented multi-stage `Dockerfile` for production
- Created comprehensive `docker-compose.yml` with Postgres, RabbitMQ, App, Prometheus, and Grafana
- Configured health checks and resource limits
- Added `docker:*` scripts to `package.json`
- Updated documentation with usage instructions

## Status
Done

---

## Common Issues & Solutions

### Issue: "Cannot connect to Docker daemon"

**Solution:**
```bash
# Ensure Docker Desktop is running
# On macOS:
open -a Docker

# Verify Docker is running
docker info
```

### Issue: "Port already in use"

**Solution:**
```bash
# Check what's using the port
lsof -i :5432  # For PostgreSQL
lsof -i :5672  # For RabbitMQ
lsof -i :3000  # For App

# Either stop the conflicting process or change ports in .env:
POSTGRES_PORT=5433
RABBITMQ_PORT=5673
APP_PORT=3001
```

### Issue: "App container keeps restarting"

**Solution:**
```bash
# Check app logs
docker-compose logs app

# Common causes:
# 1. Database not ready - wait for postgres health check
# 2. Missing environment variables - check .env file
# 3. Prisma client not generated - rebuild container
docker-compose build --no-cache app
```

### Issue: "Hot reload not working"

**Solution:**
```bash
# Ensure volumes are mounted correctly
docker-compose exec app ls -la /app/src

# Check if chokidar/nodemon is working
docker-compose logs -f app

# On macOS, ensure Docker has file sharing enabled for project directory
# Docker Desktop > Settings > Resources > File Sharing
```

### Issue: "Database migration fails in container"

**Solution:**
```bash
# Ensure database is ready
docker-compose exec postgres pg_isready

# Run migration with verbose output
docker-compose exec app npx prisma migrate dev --name init

# If schema issues, reset database
docker-compose exec app npx prisma migrate reset
```

---

## 🔗 Future Story Integration

| Story | Epic | Integration Point |
|-------|------|-------------------|
| **1.11** | Foundation | GitHub Actions uses Dockerfile for CI builds |
| **1.8** | Foundation | Prometheus scrapes /metrics endpoint |
| **2.x** | AI Routing | AI providers connect via app container |
| **4.x** | GitHub | GitHub webhooks hit app container |
| **10.x** | Real-Time | Socket.IO runs in app container |

---

## References

| Source | Section | Relevance |
|--------|---------|-----------|
| Architecture | Project Structure (docker/) | Directory structure |
| Architecture | Deployment & DevOps | Docker + Docker Compose stack |
| Architecture | Technology Stack | Service versions |
| Epics | Story 1.10 acceptance criteria | Core requirements |
| PRD | NFR-M5-M7 | Zero-downtime, rollback, IaC requirements |
| PRD | NFR-O5 | Prometheus metrics requirement |

---

## Dev Agent Record

**Story Status:** Ready for developer implementation  
**Context Completeness:** ✅ COMPREHENSIVE  
**Developer Readiness:** ✅ ULTIMATE IMPLEMENTATION GUIDE

**Key Implementation Notes:**
- Start by creating docker/ directory structure
- Dockerfile.dev prioritizes hot reload via volume mounts
- Dockerfile uses multi-stage build for production (smaller image)
- docker-compose.yml uses depends_on with health checks
- Monitoring stack (Prometheus + Grafana) is optional via `--profile monitoring`
- All services share `dsf-network` bridge network
- Named volumes ensure data persistence

**Dependencies from Previous Stories:**
- Story 1.3 (PostgreSQL): DATABASE_URL connection string format
- Story 1.4 (Configuration): Environment variable loading
- Story 1.5 (RabbitMQ): RABBITMQ_URL connection string format
- Story 1.7 (Winston Logging): Container stdout logs formatted via Winston
- Story 1.8 (Prometheus): /metrics endpoint for monitoring stack

**What This Enables:**
- Consistent development environment across team
- Easy onboarding for new developers
- Integration testing with real services
- Production-like local environment

**Document prepared by:** Bob (Scrum Master)  
**Preparation date:** 2025-11-30

