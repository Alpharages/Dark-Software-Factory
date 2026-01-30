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

# Install build tools for native modules (node-pty requires python3, make, g++)
RUN apk add --no-cache python3 make g++ libgcc libstdc++

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

# Install runtime dependencies for node-pty
RUN apk add --no-cache libgcc libstdc++

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
