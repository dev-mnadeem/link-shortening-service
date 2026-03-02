# syntax=docker/dockerfile:1

# ---- deps: production dependency tree only -------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- build: full tree, used to lint and test the image contents ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run lint && npm test

# ---- runtime -------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# The node image already ships an unprivileged `node` user (uid 1000).
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node sql ./sql

USER node
EXPOSE 3000

# Liveness only: /readyz additionally checks MySQL, which would make the
# container unhealthy during a database restart it could otherwise survive.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run node directly so the process is PID 1 and receives SIGTERM for the
# graceful shutdown in src/server.js. An `npm start` wrapper would swallow it.
CMD ["node", "src/server.js"]
