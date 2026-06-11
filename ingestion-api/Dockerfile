# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Copy lockfile first — Docker layer cache skips npm ci when nothing changed.
COPY package.json package-lock.json ./

# npm ci (vs npm install):
#   - Installs exactly what's in package-lock.json (no surprise version bumps)
#   - Fails if lock file is out of sync with package.json
#   - Always a clean install — deterministic, reproducible builds
RUN npm ci --omit=dev

# ── Stage 2: runtime image ────────────────────────────────────────────────────
# Multi-stage: only production node_modules land in the final image.
# Dev dependencies (jest, eslint, etc.) are excluded → smaller attack surface.
FROM node:20-alpine AS runtime
WORKDIR /app

# Non-root user — running as root inside a container means a container escape
# equals root on the host. Least privilege limits the blast radius.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY package.json ./

USER appuser

EXPOSE 5000

# Exec form — avoids a shell wrapper so OS signals (SIGTERM) reach node directly.
CMD ["node", "src/index.js"]
