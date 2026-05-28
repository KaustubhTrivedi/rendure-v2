FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY api/package.json api/package-lock.json ./
RUN npm ci

COPY api/tsconfig.json ./
COPY api/src/ src/
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PROJECT_ROOT=/app
ENV PATH="/app/.venv/bin:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates curl python3 fontconfig libfontconfig1 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY .python-version pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY api/package.json ./package.json
COPY agents/ agents/
COPY utils/ utils/
COPY resume/ resume/
COPY run_agents.py ./

EXPOSE 3002 1455
HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=20s \
  CMD curl -fsS http://localhost:3002/ >/dev/null || exit 1
CMD ["node", "dist/index.js"]
