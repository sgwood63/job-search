# Multi-stage build for the job search webapp.
# Build context must be the repo root (not webapp/) — docs are copied from root.
#
# Local (docker-compose):  docker compose -f webapp/docker-compose.yml up
# K8s:                     docker build -f webapp/Dockerfile -t job-search-webapp:latest .
#                          kubectl apply -f integrations/ob1/k8s/webapp.yml
#
# All configuration is injected at runtime — no secrets in this file.
# ANTHROPIC_API_DEPLOYMENT_KEY is required for chat sessions (no OAuth in containers).

# ---------------------------------------------------------------------------
# Stage 1: Build frontend + install claude binary
# ---------------------------------------------------------------------------
FROM node:20-slim AS builder

# Build React frontend
WORKDIR /build
COPY webapp/frontend/package*.json ./
RUN npm ci
COPY webapp/frontend/ ./
RUN npm run build

# Install claude binary (placed at /usr/local/bin/claude)
# Must be >=2.1.152; same Debian base as runtime so glibc is compatible.
RUN npm install -g @anthropic-ai/claude-code

# ---------------------------------------------------------------------------
# Stage 2: Python runtime
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS runtime

# Copy claude binary from builder (same Debian/glibc — no compat issues)
COPY --from=builder /usr/local/bin/claude /usr/local/bin/claude

# Install Python dependencies
COPY webapp/backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

# Install Playwright browser binary and system dependencies (libnss3, libatk-bridge2.0-0, etc.)
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN playwright install --with-deps chromium

ENV PLAYWRIGHT_PYTHON=python3

# Set up repo layout so APP_DIR defaults to /app:
#   main.py is at /app/webapp/backend/main.py
#   Path(__file__).parent.parent.parent → /app
WORKDIR /app

# Copy backend source
COPY webapp/backend/ webapp/backend/

# Copy built frontend dist — served as StaticFiles by FastAPI:
#   Path(__file__).parent.parent / 'frontend' / 'dist' → /app/webapp/frontend/dist
COPY --from=builder /build/dist webapp/frontend/dist/

# Copy repo-level docs served by the DOCS_ALLOWLIST endpoints
COPY README.md USER-GUIDE.md QUICK-START.md applicant-setup.md DEVELOPER-README.md ./

# Copy Claude Code rules — required for claude binary to operate correctly inside container.
# CLAUDE.md is auto-loaded at session start; memory/ and .claude/ provide feedback rules,
# slash commands, and project settings. scripts/ and templates/ are used by fetch-jd.py,
# generate-pdf.py, and resume CSS rendering.
COPY CLAUDE.md workflow.md ./
COPY memory/ memory/
COPY .claude/settings.json .claude/settings.json
COPY .claude/commands/ .claude/commands/
COPY .mcp.json.example .mcp.json.example
COPY scripts/ scripts/
COPY templates/ templates/
COPY skills/ skills/
COPY policies/ policies/
COPY workflows/ workflows/

# Entrypoint generates /app/.mcp.json from env vars before starting uvicorn.
COPY webapp/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Defaults — override via env vars or env_file at runtime
ENV CLAUDE_BINARY=/usr/local/bin/claude
ENV DATA_BACKEND=local

EXPOSE 8000

WORKDIR /app/webapp/backend
CMD ["/app/entrypoint.sh"]
