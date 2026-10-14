# apps/web/Dockerfile
# Multi-stage build for the FraudScope Next.js frontend
#
# Uses Next.js standalone output mode which produces a self-contained
# server that doesn't require the full node_modules at runtime.
#
# REQUIRES in next.config.ts:
#   output: 'standalone'
#
# USAGE:
#   docker build -f apps/web/Dockerfile -t fraudscope-web .
#   docker run -p 3000:3000 --env NEXT_PUBLIC_API_URL=... fraudscope-web

# ── Stage 1: Install dependencies ──────────────────────────────────
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/

RUN npm ci --workspace=apps/web --include-workspace-root

# ── Stage 2: Build Next.js ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY apps/web ./apps/web

WORKDIR /app/apps/web

# Build-time environment variables
# These are baked into the static bundle at build time
# NEXT_PUBLIC_ vars are exposed to the browser bundle
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Stage 3: Production runner ──────────────────────────────────────
FROM node:20-alpine AS runner

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Copy standalone output
# In a monorepo, standalone outputs node_modules and apps/web/server.js
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "apps/web/server.js"]