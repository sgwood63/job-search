# Claude runner sidecar — wraps the claude subprocess behind a streaming HTTP endpoint.
# Deployed as a sidecar in the K8s webapp pod; webapp calls http://localhost:8090/run
# instead of spawning subprocesses directly. Enables future independent scaling.
#
# Build: docker build -f webapp/runner/Dockerfile webapp/runner/ -t job-search-claude-runner:latest
# K8s:   see integrations/ob1/k8s/webapp.yml (sidecar container spec)

# ---------------------------------------------------------------------------
# Stage 1: install claude binary (nodejs + npm)
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates nodejs npm \
    && npm install -g @anthropic-ai/claude-code \
    && apt-get purge -y nodejs npm curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* /root/.npm

# ---------------------------------------------------------------------------
# Stage 2: minimal runtime
# ---------------------------------------------------------------------------
FROM python:3.11-slim

# Copy claude binary from builder
COPY --from=builder /usr/local/bin/claude /usr/local/bin/claude

RUN pip install --no-cache-dir fastapi "uvicorn[standard]"

COPY runner.py /app/runner.py
WORKDIR /app

EXPOSE 8090

CMD ["uvicorn", "runner:app", "--host", "0.0.0.0", "--port", "8090"]
