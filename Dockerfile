# syntax=docker/dockerfile:1.6

# ------------------------------------------------------------
# Stage 1: install deps
# ------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ------------------------------------------------------------
# Stage 2: build the Next.js standalone bundle
# ------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ------------------------------------------------------------
# Stage 3: minimal runtime
# ------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# @duckdb/node-api ships native bindings — pull them via the whole node_modules
# copy in the standalone bundle. Next 14 standalone output includes everything
# it needs under .next/standalone/.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public 2>/dev/null || true

EXPOSE 3000

# DUCKLAKE_METADATA_PATH must be provided at runtime, e.g.:
#   docker run -v /host/lake:/data -e DUCKLAKE_METADATA_PATH=/data/lake_meta.db -p 3000:3000 ducklake-inspector
CMD ["node", "server.js"]
