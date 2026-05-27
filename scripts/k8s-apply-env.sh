#!/usr/bin/env bash
# Create or update Kubernetes config from local .env values.
# Manages (all in the openbrain namespace):
#   openbrain-secret         — DB password, OB1 MCP key, LLM API keys (full create/update)
#   openbrain-configmap      — DB connection config, LLM API base URLs and model names (ConfigMap)
#   minio-secret             — MinIO credentials
#   job-search-secret        — DB password, job-search MCP key, MinIO keys, LLM API keys
#   job-search-llm-config    — LLM API base URLs and model names for job-search-mcp (ConfigMap)
#
# Safe to re-run — uses --dry-run=client | kubectl apply for all resources — no delete/recreate.
# Run after any .env credential or config change before redeploying affected pods.
#
# Usage:
#   bash scripts/k8s-apply-env.sh
#   bash scripts/k8s-apply-env.sh --context my-k3s-context
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

# Optional: pass --context <name> to target a specific kubeconfig context
KUBECTL_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --context) KUBECTL_ARGS+=(--context "$2"); shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env not found at $ENV_FILE" >&2
  echo "Run: bash scripts/setup.sh" >&2
  exit 1
fi

# shellcheck source=../.env
source "$ENV_FILE"

REQUIRED=(DB_PASSWORD OB1_MCP_KEY JOB_SEARCH_MCP_KEY MINIO_ACCESS_KEY MINIO_SECRET_KEY LLM_API_KEY)
missing=()
for var in "${REQUIRED[@]}"; do
  val="${!var:-}"
  if [[ -z "$val" || "$val" == "FILL_IN" ]]; then
    missing+=("$var")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: the following vars are unset or still FILL_IN in .env:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 1
fi

kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} get namespace openbrain &>/dev/null \
  || kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} create namespace openbrain

kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} create secret generic minio-secret \
  --namespace openbrain \
  --from-literal=MINIO_ROOT_USER="$MINIO_ACCESS_KEY" \
  --from-literal=MINIO_ROOT_PASSWORD="$MINIO_SECRET_KEY" \
  --dry-run=client -o yaml \
  | kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} apply -f -

echo "minio-secret updated in openbrain namespace."

kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} create secret generic job-search-secret \
  --namespace openbrain \
  --from-literal=DB_PASSWORD="$DB_PASSWORD" \
  --from-literal=MCP_ACCESS_KEY="$JOB_SEARCH_MCP_KEY" \
  --from-literal=MINIO_ACCESS_KEY="$MINIO_ACCESS_KEY" \
  --from-literal=MINIO_SECRET_KEY="$MINIO_SECRET_KEY" \
  --from-literal=EMBEDDING_API_KEY="$LLM_API_KEY" \
  --from-literal=CHAT_API_KEY="$LLM_API_KEY" \
  --dry-run=client -o yaml \
  | kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} apply -f -

echo "job-search-secret updated in openbrain namespace."

kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} create configmap job-search-llm-config \
  --namespace openbrain \
  --from-literal=EMBEDDING_API_BASE="${EMBEDDING_API_BASE:-https://openrouter.ai/api/v1}" \
  --from-literal=EMBEDDING_MODEL="${EMBEDDING_MODEL:-openai/text-embedding-3-small}" \
  --from-literal=CHAT_API_BASE="${CHAT_API_BASE:-https://openrouter.ai/api/v1}" \
  --from-literal=CHAT_MODEL="${CHAT_MODEL:-openai/gpt-4o-mini}" \
  --dry-run=client -o yaml \
  | kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} apply -f -

echo "job-search-llm-config updated in openbrain namespace."

kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} create secret generic openbrain-secret \
  --namespace openbrain \
  --from-literal=postgres-password="$DB_PASSWORD" \
  --from-literal=mcp-access-key="$OB1_MCP_KEY" \
  --from-literal=embedding-api-key="$LLM_API_KEY" \
  --from-literal=chat-api-key="$LLM_API_KEY" \
  --dry-run=client -o yaml \
  | kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} apply -f -

echo "openbrain-secret updated in openbrain namespace."

kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} create configmap openbrain-configmap \
  --namespace openbrain \
  --from-literal=DB_HOST="${DB_HOST:-localhost}" \
  --from-literal=DB_PORT="${DB_PORT:-5432}" \
  --from-literal=DB_NAME="${DB_NAME:-openbrain}" \
  --from-literal=DB_USER="${DB_USER:-postgres}" \
  --from-literal=EMBEDDING_API_BASE="${EMBEDDING_API_BASE:-https://openrouter.ai/api/v1}" \
  --from-literal=EMBEDDING_MODEL="${EMBEDDING_MODEL:-openai/text-embedding-3-small}" \
  --from-literal=CHAT_API_BASE="${CHAT_API_BASE:-https://openrouter.ai/api/v1}" \
  --from-literal=CHAT_MODEL="${CHAT_MODEL:-openai/gpt-4o-mini}" \
  --dry-run=client -o yaml \
  | kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} apply -f -

echo "openbrain-configmap updated in openbrain namespace."

# Generate .mcp.json for Claude Code — auth keys live in .env, not committed.
# "type": "http" is required for Claude Code to recognize the Streamable HTTP transport.
# Append /mcp to the base URLs defined in .env to reach the MCP endpoint.
MCP_JSON="$SCRIPT_DIR/../.mcp.json"
OB1_BASE="${OB1_MCP_URL:-http://localhost/ob1}"
JS_BASE="${JOB_SEARCH_MCP_URL:-http://localhost/job-search}"
cat > "$MCP_JSON" <<EOF
{
  "mcpServers": {
    "open-brain": {
      "type": "http",
      "url": "${OB1_BASE}/mcp",
      "headers": { "x-brain-key": "$OB1_MCP_KEY" }
    },
    "job-search": {
      "type": "http",
      "url": "${JS_BASE}/mcp",
      "headers": { "x-brain-key": "$JOB_SEARCH_MCP_KEY" }
    }
  }
}
EOF

echo ".mcp.json written with OB1 and job-search access keys."
