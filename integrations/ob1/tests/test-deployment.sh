#!/usr/bin/env bash
# test-deployment.sh — OB1 + job-search-mcp deployment verification
#
# Usage:
#   bash integrations/ob1/tests/test-deployment.sh                      # run all tests
#   bash integrations/ob1/tests/test-deployment.sh test_js_tables        # run one test
#
# Environment:
#   K8S_BASE_URL   Base URL for HTTP tests (default: http://localhost)
#   Source .env first to provide MINIO_*, OB1_MCP_KEY, JOB_SEARCH_MCP_KEY, DB_*
#
# Platform notes:
#   Docker Desktop (Mac): K8S_BASE_URL=http://localhost (LoadBalancer binds directly)
#   minikube:             K8S_BASE_URL=http://$(minikube ip)
#   k3d:                  K8S_BASE_URL=http://$(kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
#

set -euo pipefail

NAMESPACE="openbrain"
K8S_BASE_URL="${K8S_BASE_URL:-http://localhost}"
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}  $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo -e "${RED}FAIL${NC}  $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
skip() { echo -e "${YELLOW}SKIP${NC}  $1"; SKIP_COUNT=$((SKIP_COUNT + 1)); }
header() { echo -e "\n=== $1 ==="; }

require_env() {
  local var="$1"
  if [[ -z "${!var:-}" ]]; then
    skip "$var not set — skipping test"
    return 1
  fi
  return 0
}

mcp_call() {
  local url="$1" key="$2" tool="$3" args="$4"
  curl -s "$url" \
    -H "x-brain-key: $key" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args},\"id\":1}" \
    2>/dev/null | grep '^data: ' | head -1 | sed 's/^data: //'
}

mcp_list_tools() {
  local url="$1" key="$2"
  curl -s "$url" \
    -H "x-brain-key: $key" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
    2>/dev/null | grep '^data: ' | head -1 | sed 's/^data: //'
}

psql_exec() {
  kubectl exec -n "$NAMESPACE" openbrain-0 -c db -- \
    psql -U postgres -d openbrain -tAc "$1" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Infrastructure tests
# ---------------------------------------------------------------------------

test_namespace() {
  header "Namespace"
  if kubectl get namespace "$NAMESPACE" &>/dev/null; then
    pass "openbrain namespace exists"
  else
    fail "openbrain namespace missing"
  fi
}

test_secrets() {
  header "Secrets & ConfigMaps"
  local expected=("openbrain-secret" "job-search-secret" "minio-secret" "webapp-secret"
                  "dashboard-secret" "openbrain-configmap" "job-search-llm-config")
  local missing=()
  local existing
  existing=$(kubectl get secret,configmap -n "$NAMESPACE" --no-headers 2>/dev/null || true)
  for name in "${expected[@]}"; do
    if ! echo "$existing" | grep -q "$name"; then
      missing+=("$name")
    fi
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    pass "All 7 secrets/configmaps present"
  else
    fail "Missing: ${missing[*]}"
  fi
}

test_pods() {
  header "Pods"
  local pods
  pods=$(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null)

  # Plain pods: just check Running
  for expected in "minio" "ob1-rest-pg" "ob1-dashboard" "job-search-mcp"; do
    local pod_line status restarts
    pod_line=$(echo "$pods" | grep "$expected" | head -1)
    if [[ -z "$pod_line" ]]; then
      fail "$expected pod not found"
      continue
    fi
    status=$(echo "$pod_line" | awk '{print $3}')
    restarts=$(echo "$pod_line" | awk '{print $4}')
    if [[ "$status" == "Running" ]]; then
      pass "$expected: Running (restarts: $restarts)"
    else
      fail "$expected: $status (restarts: $restarts)"
    fi
  done

  # openbrain-0: must be 3/3 (db + mcp-server + langfuse-proxy)
  local ob_line ob_ready ob_status ob_restarts
  ob_line=$(echo "$pods" | grep "^openbrain-0" | head -1)
  if [[ -z "$ob_line" ]]; then
    fail "openbrain-0 pod not found"
  else
    ob_ready=$(echo "$ob_line" | awk '{print $2}')
    ob_status=$(echo "$ob_line" | awk '{print $3}')
    ob_restarts=$(echo "$ob_line" | awk '{print $4}')
    if [[ "$ob_status" == "Running" && "$ob_ready" == "3/3" ]]; then
      pass "openbrain-0: Running 3/3 (restarts: $ob_restarts)"
    else
      fail "openbrain-0: $ob_status $ob_ready (expected Running 3/3, restarts: $ob_restarts)"
    fi
  fi

  # job-search-webapp: must be 2/2 (webapp + claude-runner)
  local wa_line wa_ready wa_status wa_restarts
  wa_line=$(echo "$pods" | grep "job-search-webapp" | head -1)
  if [[ -z "$wa_line" ]]; then
    fail "job-search-webapp pod not found"
  else
    wa_ready=$(echo "$wa_line" | awk '{print $2}')
    wa_status=$(echo "$wa_line" | awk '{print $3}')
    wa_restarts=$(echo "$wa_line" | awk '{print $4}')
    if [[ "$wa_status" == "Running" && "$wa_ready" == "2/2" ]]; then
      pass "job-search-webapp: Running 2/2 (restarts: $wa_restarts)"
    else
      fail "job-search-webapp: $wa_status $wa_ready (expected Running 2/2, restarts: $wa_restarts)"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Database tests
# ---------------------------------------------------------------------------

test_postgres_connect() {
  header "PostgreSQL"
  if psql_exec "SELECT 1" | grep -q "1"; then
    pass "psql connection to openbrain-0 db container"
  else
    fail "psql connection failed"
  fi
}

test_js_tables() {
  header "job-search Schema (js_* tables)"
  local expected=("js_applicant" "js_applications" "js_chunks" "js_companies" "js_contacts"
                  "js_experience" "js_files" "js_ingested_positions" "js_interviews"
                  "js_profiles" "js_search_runs")
  local missing=()
  local found
  # psql -tA outputs pipe-delimited: schema|tablename|type|owner
  found=$(psql_exec "\dt js_*" | awk -F'|' '{print $2}' | tr -d ' ')
  for tbl in "${expected[@]}"; do
    if ! echo "$found" | grep -q "^${tbl}$"; then
      missing+=("$tbl")
    fi
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    pass "All 11 js_* tables present"
  else
    fail "Missing tables: ${missing[*]}"
  fi
}

# ---------------------------------------------------------------------------
# MinIO tests
# ---------------------------------------------------------------------------

test_minio_bucket() {
  header "MinIO Bucket"
  if ! require_env MINIO_ENDPOINT; then return; fi
  if ! require_env MINIO_ACCESS_KEY; then return; fi
  if ! require_env MINIO_SECRET_KEY; then return; fi
  if ! require_env MINIO_BUCKET; then return; fi

  local venv_python
  if [[ -f ".venv/bin/python3" ]]; then
    venv_python=".venv/bin/python3"
  else
    venv_python="python3"
  fi

  local result
  result=$("$venv_python" -c "
import sys, os
try:
    from minio import Minio
    c = Minio(os.environ['MINIO_ENDPOINT'], os.environ['MINIO_ACCESS_KEY'], os.environ['MINIO_SECRET_KEY'], secure=False)
    exists = c.bucket_exists(os.environ['MINIO_BUCKET'])
    print('exists' if exists else 'missing')
except Exception as e:
    print(f'error: {e}')
" 2>/dev/null)

  if [[ "$result" == "exists" ]]; then
    pass "MinIO bucket '${MINIO_BUCKET}' exists"
  elif [[ "$result" == "missing" ]]; then
    fail "MinIO bucket '${MINIO_BUCKET}' not found — run bucket creation step"
  else
    fail "MinIO check failed: $result"
  fi
}

# ---------------------------------------------------------------------------
# Ingress & MCP server tests
# ---------------------------------------------------------------------------

test_ingress() {
  header "Ingress Routing"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$K8S_BASE_URL/ob1/" 2>/dev/null)
  if [[ "$status" == "401" || "$status" == "200" ]]; then
    pass "OB1 Ingress path responds (HTTP $status)"
  elif [[ "$status" == "000" ]]; then
    fail "Ingress not reachable at $K8S_BASE_URL (connection refused)"
  else
    fail "Unexpected HTTP $status from $K8S_BASE_URL/ob1/"
  fi
}

test_ob1_mcp() {
  header "OB1 MCP Server"
  if ! require_env OB1_MCP_KEY; then return; fi

  local response
  response=$(mcp_list_tools "$K8S_BASE_URL/ob1/mcp" "$OB1_MCP_KEY")
  local tool_count
  tool_count=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('result',{}).get('tools',[])))" 2>/dev/null || echo "0")

  if [[ "$tool_count" -gt 0 ]]; then
    pass "OB1 MCP responds — $tool_count tools"
  else
    fail "OB1 MCP failed or returned 0 tools (response: ${response:0:100})"
  fi
}

test_job_search_mcp() {
  header "job-search MCP Server"
  if ! require_env JOB_SEARCH_MCP_KEY; then return; fi

  local response
  response=$(mcp_list_tools "$K8S_BASE_URL/job-search/mcp" "$JOB_SEARCH_MCP_KEY")
  local tool_count
  tool_count=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('result',{}).get('tools',[])))" 2>/dev/null || echo "0")

  if [[ "$tool_count" -eq 26 ]]; then
    pass "job-search MCP responds — 26 tools"
  elif [[ "$tool_count" -gt 0 ]]; then
    fail "job-search MCP responded with $tool_count tools (expected 26)"
  else
    fail "job-search MCP failed or returned 0 tools (response: ${response:0:100})"
  fi
}

test_mcp_json() {
  header ".mcp.json"
  if [[ ! -f ".mcp.json" ]]; then
    fail ".mcp.json does not exist — run: source .env && bash scripts/k8s-apply-env.sh"
    return
  fi
  local has_ob1 has_js
  has_ob1=$(python3 -c "import json; d=json.load(open('.mcp.json')); print('ok' if 'open-brain' in d.get('mcpServers',{}) else 'missing')" 2>/dev/null)
  has_js=$(python3 -c "import json; d=json.load(open('.mcp.json')); print('ok' if 'job-search' in d.get('mcpServers',{}) else 'missing')" 2>/dev/null)

  if [[ "$has_ob1" == "ok" && "$has_js" == "ok" ]]; then
    pass ".mcp.json exists with both open-brain and job-search servers"
  else
    fail ".mcp.json missing servers — open-brain: $has_ob1, job-search: $has_js"
  fi
}

# ---------------------------------------------------------------------------
# Migration data tests
# ---------------------------------------------------------------------------

test_migration_data() {
  header "Migration Data"
  local applicant_count files_count
  applicant_count=$(psql_exec "SELECT count(*) FROM js_applicant" 2>/dev/null | tr -d ' ')
  files_count=$(psql_exec "SELECT count(*) FROM js_files" 2>/dev/null | tr -d ' ')

  if [[ "${applicant_count:-0}" -gt 0 ]]; then
    pass "js_applicant: $applicant_count row(s)"
  else
    fail "js_applicant is empty — run migrate-to-ob1.py (with port-forward active)"
  fi

  if [[ "${files_count:-0}" -gt 0 ]]; then
    pass "js_files: $files_count rows"
  else
    fail "js_files is empty — run migrate-to-ob1.py"
  fi

  if ! require_env MINIO_ENDPOINT; then return; fi
  if ! require_env MINIO_BUCKET; then return; fi

  local venv_python
  if [[ -f ".venv/bin/python3" ]]; then
    venv_python=".venv/bin/python3"
  else
    venv_python="python3"
  fi

  local minio_count
  minio_count=$("$venv_python" -c "
import os
try:
    from minio import Minio
    c = Minio(os.environ['MINIO_ENDPOINT'], os.environ['MINIO_ACCESS_KEY'], os.environ['MINIO_SECRET_KEY'], secure=False)
    objs = list(c.list_objects(os.environ['MINIO_BUCKET'], recursive=True))
    print(len(objs))
except Exception as e:
    print(0)
" 2>/dev/null)

  if [[ "${minio_count:-0}" -gt 0 ]]; then
    pass "MinIO: $minio_count files in bucket"
  else
    fail "MinIO bucket empty — run migrate-to-ob1.py"
  fi
}

# ---------------------------------------------------------------------------
# MCP tool functional tests
# ---------------------------------------------------------------------------

test_mcp_get_pipeline() {
  header "MCP Functional: get_pipeline"
  if ! require_env JOB_SEARCH_MCP_KEY; then return; fi

  local response
  response=$(mcp_call "$K8S_BASE_URL/job-search/mcp" "$JOB_SEARCH_MCP_KEY" "get_pipeline" '{"limit":1}')
  local is_error
  is_error=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('isError',''))" 2>/dev/null)

  if [[ "$is_error" == "True" || "$is_error" == "true" ]]; then
    local msg
    msg=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('content',[{}])[0].get('text',''))" 2>/dev/null)
    fail "get_pipeline returned error: $msg"
  else
    pass "get_pipeline: OK"
  fi
}

test_mcp_upload_get_file() {
  header "MCP Functional: upload_file + get_file round-trip"
  if ! require_env JOB_SEARCH_MCP_KEY; then return; fi

  local test_key="tests/test-$(date +%s).txt"
  local test_content="test content $(date)"

  # Upload
  local up_response
  up_response=$(mcp_call "$K8S_BASE_URL/job-search/mcp" "$JOB_SEARCH_MCP_KEY" "upload_file" \
    "{\"key\":\"$test_key\",\"content\":\"$test_content\",\"content_type\":\"text/plain\"}")
  local up_error
  up_error=$(echo "$up_response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('isError',''))" 2>/dev/null)

  if [[ "$up_error" == "True" || "$up_error" == "true" ]]; then
    fail "upload_file failed"
    return
  fi
  pass "upload_file: OK"

  # Get
  local get_response got_content
  get_response=$(mcp_call "$K8S_BASE_URL/job-search/mcp" "$JOB_SEARCH_MCP_KEY" "get_file" \
    "{\"key\":\"$test_key\"}")
  got_content=$(echo "$get_response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('content',[{}])[0].get('text',''))" 2>/dev/null)

  if [[ "$got_content" == "$test_content" ]]; then
    pass "get_file: round-trip content matches"
  else
    fail "get_file: content mismatch (got: '${got_content:0:50}')"
  fi

  # Cleanup
  mcp_call "$K8S_BASE_URL/job-search/mcp" "$JOB_SEARCH_MCP_KEY" "delete_file" \
    "{\"key\":\"$test_key\"}" &>/dev/null || true
}

test_mcp_create_application() {
  header "MCP Functional: create_application"
  if ! require_env JOB_SEARCH_MCP_KEY; then return; fi

  local response
  response=$(mcp_call "$K8S_BASE_URL/job-search/mcp" "$JOB_SEARCH_MCP_KEY" "create_application" \
    '{"company_name":"Test Co","role_title":"Test Role","folder_prefix":"applications/test-create-application/","status":"pending-review","priority":1}')
  local text
  text=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('content',[{}])[0].get('text',''))" 2>/dev/null)

  if echo "$text" | grep -q "Application created:"; then
    # Extract UUID and clean up
    local app_id
    app_id=$(echo "$text" | grep -oE '[0-9a-f-]{36}')
    pass "create_application: $text"
    # Delete test record via psql
    psql_exec "DELETE FROM js_applications WHERE id = '$app_id'" &>/dev/null || true
  else
    fail "create_application failed: $text"
  fi
}

# ---------------------------------------------------------------------------
# Langfuse tests
# ---------------------------------------------------------------------------

test_langfuse_keys() {
  header "Langfuse Keys in Secrets"
  local pub_key
  pub_key=$(kubectl get secret openbrain-secret -n "$NAMESPACE" \
    -o jsonpath='{.data.langfuse-public-key}' 2>/dev/null | base64 -d 2>/dev/null)
  if [[ -n "$pub_key" && "$pub_key" != "FILL_IN" ]]; then
    pass "openbrain-secret: langfuse-public-key present"
  else
    fail "openbrain-secret: langfuse-public-key missing or placeholder"
  fi

  local wa_pub
  wa_pub=$(kubectl get secret webapp-secret -n "$NAMESPACE" \
    -o jsonpath='{.data.LANGFUSE_PUBLIC_KEY}' 2>/dev/null | base64 -d 2>/dev/null)
  if [[ -n "$wa_pub" && "$wa_pub" != "FILL_IN" ]]; then
    pass "webapp-secret: LANGFUSE_PUBLIC_KEY present"
  else
    fail "webapp-secret: LANGFUSE_PUBLIC_KEY missing or placeholder"
  fi
}

test_langfuse_proxy() {
  header "Langfuse Proxy Sidecar"
  local health
  health=$(kubectl exec -n "$NAMESPACE" openbrain-0 -c langfuse-proxy -- \
    deno eval "const r = await fetch('http://localhost:8080/health'); console.log(r.status, await r.text())" \
    2>/dev/null || echo "")
  if echo "$health" | grep -q "^200"; then
    pass "langfuse-proxy /health: 200 ok"
  else
    fail "langfuse-proxy /health failed (got: '${health:0:80}')"
  fi
}

test_webapp_health() {
  header "Webapp Health"
  local response backend rest_status
  response=$(curl -s "$K8S_BASE_URL:30800/api/health" 2>/dev/null)
  backend=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('backend',''))" 2>/dev/null)
  rest_status=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('rest',''))" 2>/dev/null)
  if [[ "$backend" == "ob1" && "$rest_status" == "ok" ]]; then
    pass "webapp /api/health: backend=ob1 rest=ok"
  elif [[ "$backend" == "ob1" ]]; then
    fail "webapp /api/health: backend=ob1 but rest=$rest_status"
  else
    fail "webapp /api/health failed (response: '${response:0:100}')"
  fi
}

# ---------------------------------------------------------------------------
# Test runner
# ---------------------------------------------------------------------------

ALL_TESTS=(
  test_namespace
  test_secrets
  test_pods
  test_postgres_connect
  test_js_tables
  test_minio_bucket
  test_ingress
  test_ob1_mcp
  test_job_search_mcp
  test_mcp_json
  test_langfuse_keys
  test_langfuse_proxy
  test_webapp_health
  test_migration_data
  test_mcp_get_pipeline
  test_mcp_upload_get_file
  test_mcp_create_application
)

# Load .env if present and not already sourced
if [[ -f ".env" && -z "${APP_DIR:-}" ]]; then
  source .env 2>/dev/null || true
fi

if [[ $# -eq 1 ]]; then
  # Run single named test
  if declare -f "$1" > /dev/null; then
    "$1"
  else
    echo "Unknown test: $1"
    echo "Available: ${ALL_TESTS[*]}"
    exit 1
  fi
else
  # Run all
  for test_fn in "${ALL_TESTS[@]}"; do
    "$test_fn"
  done
fi

echo -e "\n========================================="
echo -e "Results: ${GREEN}${PASS_COUNT} passed${NC}  ${RED}${FAIL_COUNT} failed${NC}  ${YELLOW}${SKIP_COUNT} skipped${NC}"
echo "========================================="

[[ "$FAIL_COUNT" -eq 0 ]]
