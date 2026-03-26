# ===========================================
# Dark Software Factory - Production Image
# ===========================================
# Purpose: Optimized production deployment
# Multi-stage build for minimal image size
# Used by: Story 1.11 (CI/CD Pipeline)
# ===========================================

# ---- Build Stage ----
FROM node:22-alpine AS build

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install ALL dependencies (HUSKY=0 skips git-hooks setup in CI/Docker)
RUN HUSKY=0 pnpm install --frozen-lockfile

# Copy Prisma schema and config
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# Compile seed files for production (ts-node not available at runtime)
# --rootDir . anchors the output structure so dist-seed/prisma/seed.js is stable
RUN npx tsc --module commonjs --moduleResolution node --esModuleInterop --resolveJsonModule \
    --target ES2022 --rootDir . --outDir dist-seed --skipLibCheck \
    prisma/seed.ts prisma/seeds/admin.seeder.ts prisma/seeds/system-config.seeder.ts

# ---- Production Stage ----
FROM node:22-alpine AS production

# Install runtime dependencies for git
RUN apk add --no-cache bash git

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

# Enable pnpm (needed to prune devDependencies)
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy built artifacts and full node_modules from build stage.
# Copying node_modules from the build stage (not a separate --prod install) ensures
# the pnpm virtual store paths match what prisma generate wrote during the build.
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-seed ./dist-seed
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml ./

# Remove devDependencies from the copied node_modules
RUN HUSKY=0 pnpm prune --prod

# Set ownership to non-root user
RUN chown -R nestjs:nodejs /app /home/nestjs

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
