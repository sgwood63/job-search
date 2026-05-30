#!/usr/bin/env bash
# Container entrypoint: generates /app/.mcp.json from env vars, then starts uvicorn.
# MCP keys and URLs are injected via environment (docker-compose env_file or k8s secret/configmap).
# Falls back to localhost URLs from .mcp.json.example if vars are unset.
set -e

# Write .env so Claude's /context workflow can resolve APP_DIR, DATA_BACKEND, DEV_MODE.
# Sensitive credentials are already env vars; only the path/mode variables go here.
cat > /app/.env << EOF
export APP_DIR="${APP_DIR:-/app}"
export DATA_BACKEND="${DATA_BACKEND:-ob1}"
export DEV_MODE="${DEV_MODE:-false}"
export PLAYWRIGHT_PYTHON="${PLAYWRIGHT_PYTHON:-python3}"
EOF

cat > /app/.mcp.json << EOF
{
  "mcpServers": {
    "open-brain": {
      "type": "http",
      "url": "${OB1_MCP_URL:-http://localhost/ob1/mcp}",
      "headers": { "x-brain-key": "${OB1_MCP_KEY:-}" }
    },
    "job-search": {
      "type": "http",
      "url": "${JOB_SEARCH_MCP_URL:-http://localhost/job-search/mcp}",
      "headers": { "x-brain-key": "${JOB_SEARCH_MCP_KEY:-}" }
    }
  }
}
EOF

exec uvicorn main:app --host 0.0.0.0 --port 8000
