#!/usr/bin/env bash
# Create or update Kubernetes config from local .env values.
# Manages (all in the openbrain namespace):
#   openbrain-secret         — DB password only (OB1 MCP + LLM keys removed after merge)
#   openbrain-configmap      — DB connection config only (DB_HOST, DB_PORT, DB_NAME, DB_USER)
#   minio-secret             — MinIO credentials
#   job-search-secret        — DB password, job-search MCP key, MinIO keys, LLM API keys, Langfuse
#   job-search-llm-config    — LLM API base URLs and model names for job-search-mcp (ConfigMap)
#   webapp-secret            — ANTHROPIC_API_KEY, JOB_SEARCH_MCP_KEY for webapp + runner
#
# Safe to re-run — uses --dry-run=client | kubectl apply for all resources — no delete/recreate.
# Run after any .env or .env.services change before redeploying affected pods.
# Requires both .env (MCP keys) and .env.services (DB/MinIO/LLM credentials).
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

SERVICES_ENV_FILE="$SCRIPT_DIR/../.env.services"
if [[ ! -f "$SERVICES_ENV_FILE" ]]; then
  echo "ERROR: .env.services not found at $SERVICES_ENV_FILE" >&2
  echo "Copy .env.services.example to .env.services and fill in your credentials." >&2
  exit 1
fi

# shellcheck source=../.env
source "$ENV_FILE"
# shellcheck source=../.env.services
source "$SERVICES_ENV_FILE"

# K8S_LANGFUSE_HOST defaults to host.docker.internal when running under Docker Desktop.
# LANGFUSE_HOST stays as-is for the local webapp (host-side process, can use localhost).
K8S_LANGFUSE_HOST="${K8S_LANGFUSE_HOST:-http://host.docker.internal:3000}"

REQUIRED=(DB_PASSWORD JOB_SEARCH_MCP_KEY MINIO_ACCESS_KEY MINIO_SECRET_KEY LLM_API_KEY)
missing=()
for var in "${REQUIRED[@]}"; do
  val="${!var:-}"
  if [[ -z "$val" || "$val" == "FILL_IN" ]]; then
    missing+=("$var")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: the following vars are unset or still placeholder in .env / .env.services:" >&2
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
  --from-literal=LANGFUSE_HOST="$K8S_LANGFUSE_HOST" \
  --from-literal=LANGFUSE_PUBLIC_KEY="${LANGFUSE_PUBLIC_KEY:-}" \
  --from-literal=LANGFUSE_SECRET_KEY="${LANGFUSE_SECRET_KEY:-}" \
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

# openbrain-secret: postgres-password only after OB1 MCP + langfuse-proxy removal.
# The db container in the openbrain StatefulSet is the only consumer.
kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} create secret generic openbrain-secret \
  --namespace openbrain \
  --from-literal=postgres-password="$DB_PASSWORD" \
  --dry-run=client -o yaml \
  | kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} apply -f -

echo "openbrain-secret updated in openbrain namespace."

# openbrain-configmap: DB connection vars only after OB1 MCP + langfuse-proxy removal.
# The db container needs DB_USER and DB_NAME (POSTGRES_USER, POSTGRES_DB env vars).
kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} create configmap openbrain-configmap \
  --namespace openbrain \
  --from-literal=DB_HOST="${DB_HOST:-localhost}" \
  --from-literal=DB_PORT="${DB_PORT:-5432}" \
  --from-literal=DB_NAME="${DB_NAME:-openbrain}" \
  --from-literal=DB_USER="${DB_USER:-postgres}" \
  --dry-run=client -o yaml \
  | kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} apply -f -

echo "openbrain-configmap updated in openbrain namespace."

kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} create secret generic webapp-secret \
  --namespace openbrain \
  --from-literal=ANTHROPIC_API_KEY="${ANTHROPIC_API_DEPLOYMENT_KEY:-}" \
  --from-literal=JOB_SEARCH_MCP_KEY="$JOB_SEARCH_MCP_KEY" \
  --from-literal=LANGFUSE_HOST="$K8S_LANGFUSE_HOST" \
  --from-literal=LANGFUSE_PUBLIC_KEY="${LANGFUSE_PUBLIC_KEY:-}" \
  --from-literal=LANGFUSE_SECRET_KEY="${LANGFUSE_SECRET_KEY:-}" \
  --dry-run=client -o yaml \
  | kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} apply -f -

echo "webapp-secret updated in openbrain namespace."

# Generate .mcp.json for Claude Code — auth keys live in .env, not committed.
# "type": "http" is required for Claude Code to recognize the Streamable HTTP transport.
# Single MCP server: job-search contains all OB1 + job-search tools (35 total).
MCP_JSON="$SCRIPT_DIR/../.mcp.json"
JS_BASE="${JOB_SEARCH_MCP_URL:-http://localhost/job-search}"
cat > "$MCP_JSON" <<EOF
{
  "mcpServers": {
    "job-search": {
      "type": "http",
      "url": "${JS_BASE}/mcp",
      "headers": { "x-brain-key": "$JOB_SEARCH_MCP_KEY" }
    }
  }
}
EOF

echo ".mcp.json written with job-search access key (single server — no open-brain)."

# ---------------------------------------------------------------------------
# Harden ingress-nginx controller probe timeouts.
#
# Docker Desktop's ingress-nginx ships with 1s probe timeouts, which are too
# tight for a shared-VM dev environment. Under CPU load (bulk ingestion, PDF
# upload) the /healthz endpoint can take >1s to respond, causing Kubernetes
# to kill and restart the controller — which takes NGINX offline and causes
# 502/504 errors on all /job-search routes until the new pod is ready.
#
# This patch raises timeoutSeconds to 5s and periodSeconds to 15s on the
# liveness probe, and timeoutSeconds to 5s on the readiness probe.
# It is idempotent — safe to re-run on an already-patched cluster.
# ---------------------------------------------------------------------------
INGRESS_NS="ingress-nginx"
INGRESS_DEPLOY="ingress-nginx-controller"

if kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} get deployment "$INGRESS_DEPLOY" -n "$INGRESS_NS" &>/dev/null; then
  kubectl ${KUBECTL_ARGS[@]:+"${KUBECTL_ARGS[@]}"} patch deployment "$INGRESS_DEPLOY" \
    -n "$INGRESS_NS" --type='json' -p='[
      {"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe/timeoutSeconds","value":5},
      {"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe/periodSeconds","value":15},
      {"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/timeoutSeconds","value":5}
    ]'
  echo "ingress-nginx-controller probe timeouts hardened (timeout 1s→5s, liveness period 10s→15s)."
else
  echo "ingress-nginx-controller not found in namespace $INGRESS_NS — skipping probe patch."
fi
