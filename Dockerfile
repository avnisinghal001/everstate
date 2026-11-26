# One image for every Everstate service. Pick the service with SERVICE_MODULE:
#   src.ui_service.server (console, default) · src.interview_agent.server · src.preference_agent.server

# ---------------------------------------------------------------------------
# 1. Build the Vite frontend
# ---------------------------------------------------------------------------
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# 2. Python runtime
# ---------------------------------------------------------------------------
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080 \
    SERVICE_MODULE=src.ui_service.server

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.11.29 /uv /usr/local/bin/uv

COPY requirements.txt ./
RUN uv pip install --system --no-cache -r requirements.txt

COPY pyproject.toml README.md ./
COPY src/ ./src/
COPY --from=web /web/dist ./web/dist
RUN uv pip install --system --no-cache --no-deps . \
    && useradd --create-home --uid 10001 everstate

USER everstate
EXPOSE 8080

CMD ["sh", "-c", "exec python -m ${SERVICE_MODULE}"]
