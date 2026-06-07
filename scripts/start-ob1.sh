#!/usr/bin/env bash
# Start OB1 infrastructure: PostgreSQL, MinIO, openbrain-mcp, job-search-mcp.
#
# Sources both env files before running docker-compose so all ${VARNAME}
# interpolations in the compose YAML resolve correctly:
#   .env          — MCP access keys (OB1_MCP_KEY, JOB_SEARCH_MCP_KEY)
#   .env.services — storage credentials (DB, MinIO, LLM API keys)
#
# Usage:
#   bash scripts/start-ob1.sh up -d         # start detached
#   bash scripts/start-ob1.sh down          # stop and remove containers
#   bash scripts/start-ob1.sh logs -f       # tail logs
#   bash scripts/start-ob1.sh up --build    # rebuild images first
#
# All arguments are passed through to docker compose.
#
# For compose-mode overrides (DB_HOST=postgres, MINIO_ENDPOINT=minio:9000, etc.)
# see the comments at the top of integrations/ob1/docker-compose.yml.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
SERVICES_ENV_FILE="$SCRIPT_DIR/../.env.services"
COMPOSE_FILE="$SCRIPT_DIR/../integrations/ob1/docker-compose.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env not found at $ENV_FILE" >&2
  echo "Run: bash scripts/setup.sh" >&2
  exit 1
fi

if [[ ! -f "$SERVICES_ENV_FILE" ]]; then
  echo "ERROR: .env.services not found at $SERVICES_ENV_FILE" >&2
  echo "Copy .env.services.example to .env.services and fill in your credentials." >&2
  exit 1
fi

# shellcheck source=../.env
set -a
source "$ENV_FILE"
source "$SERVICES_ENV_FILE"
set +a

exec docker compose -f "$COMPOSE_FILE" "$@"
