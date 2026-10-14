# apps/api/Dockerfile
# Multi-stage Dockerfile for FraudScope API
#
# STAGES:
#   development  -- for local development with hot-reloading (used by docker-compose.yml)
#   build-deps   -- all dependencies (including dev) to compile TypeScript
#   builder      -- compiles TypeScript to dist/
#   prod-deps    -- production-only dependencies
#   runner       -- minimal, secure production image (used by docker-compose.prod.yml)

# ── Base stage ──────────────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
ENV PATH="/app/node_modules/.bin:$PATH"

# ── Stage 1: Development (docker-compose.yml) ───────────────────────
FROM base AS development

# Build tools for native modules (e.g. bcrypt) and network utilities
RUN apk add --no-cache python3 make g++ curl wget

# Install all dependencies (including devDeps like tsx)
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/

RUN npm ci --workspace=apps/api --include-workspace-root

# Copy API source files (these are also mountable via host volumes in dev)
COPY apps/api/ ./apps/api/

EXPOSE 3002

# Run with tsx watch for hot reloading in development
CMD ["npm", "run", "dev", "--workspace=apps/api"]

# ── Stage 2: Build dependencies ─────────────────────────────────────
FROM base AS build-deps

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/

RUN npm ci --workspace=apps/api --include-workspace-root

# ── Stage 3: Builder ────────────────────────────────────────────────
FROM base AS builder

COPY --from=build-deps /app/node_modules ./node_modules
COPY package.json ./
COPY apps/api ./apps/api

WORKDIR /app/apps/api
RUN npm run build

# ── Stage 4: Production dependencies ────────────────────────────────
FROM base AS prod-deps

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/

RUN npm ci --workspace=apps/api --omit=dev --include-workspace-root \
 && npm cache clean --force

# ── Stage 5: Production runner ──────────────────────────────────────
FROM base AS runner

# Install curl for production container health checks
RUN apk add --no-cache curl

# Security: non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 fraudscope

WORKDIR /app

# Copy production dependencies
COPY --from=prod-deps /app/node_modules ./node_modules
COPY apps/api/package.json ./package.json

# Copy compiled JavaScript from builder stage
COPY --from=builder /app/apps/api/dist ./dist

# Copy migration and seed files
COPY --from=builder /app/apps/api/migrations ./migrations
COPY --from=builder /app/apps/api/seeds ./seeds

# Copy knexfile -- needed by migrate command
COPY apps/api/src/config/knexfile.js ./src/config/knexfile.js

RUN chown -R fraudscope:nodejs /app

USER fraudscope

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3002/health || exit 1

# Default command: start the compiled API server
CMD ["node", "dist/index.js"]