#!/usr/bin/env bash
# ob1-restore.sh — Restore OB1 data (PostgreSQL + MinIO) from an encrypted backup archive.
#
# Prerequisites: kubectl, mc, openssl, tar (same as ob1-backup.sh)
#
# Passphrase resolution (same as ob1-backup.sh):
#   1. BACKUP_PASSPHRASE environment variable
#   2. BACKUP_PASSPHRASE_FILE environment variable (path to a file containing the passphrase)
#   3. macOS Keychain: security find-generic-password -a ob1-backup -s ob1-backup-passphrase -w
#   4. Interactive prompt — type or paste, then press Enter
#
# Usage:
#   bash scripts/ob1-restore.sh <path-to-encrypted-archive>
#
# WARNING: This REPLACES all current PostgreSQL data and MinIO objects.
#          K8s services must already be deployed — only data is restored.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# Step 1: Argument check
# ---------------------------------------------------------------------------

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/ob1-restore.sh <path-to-encrypted-archive>" >&2
  echo "" >&2
  echo "Archives are stored in the ob1-backups/ folder in your cloud sync directory." >&2
  exit 1
fi

ENCRYPTED_ARCHIVE="$1"
if [[ ! -f "$ENCRYPTED_ARCHIVE" ]]; then
  echo "ERROR: Archive not found: $ENCRYPTED_ARCHIVE" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 2: Source credentials
# ---------------------------------------------------------------------------

ENV_SERVICES="$APP_DIR/.env.services"
if [[ ! -f "$ENV_SERVICES" ]]; then
  echo "ERROR: .env.services not found at $ENV_SERVICES" >&2
  echo "       The archive contains a copy in config/env.services — restore it manually" >&2
  echo "       after decrypting, then re-run this script." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_SERVICES"

# ---------------------------------------------------------------------------
# Step 3: Prerequisites check
# ---------------------------------------------------------------------------

MISSING=()
for TOOL in kubectl mc openssl tar; do
  if ! command -v "$TOOL" &>/dev/null; then
    MISSING+=("$TOOL")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "ERROR: Missing required tools: ${MISSING[*]}" >&2
  echo "  kubectl → brew install kubectl" >&2
  echo "  mc      → brew install minio/stable/mc" >&2
  exit 1
fi

echo "==> Checking OB1 services..."

if ! kubectl get ns openbrain &>/dev/null; then
  echo "ERROR: Cannot reach Kubernetes namespace 'openbrain'." >&2
  echo "       Deploy OB1 services first, then restore data." >&2
  exit 1
fi

PG_STATUS=$(kubectl get pod openbrain-0 -n openbrain \
  -o jsonpath='{.status.phase}' 2>/dev/null || echo "")
if [[ "$PG_STATUS" != "Running" ]]; then
  echo "ERROR: openbrain-0 pod is not Running (status: ${PG_STATUS:-not found})." >&2
  exit 1
fi

MINIO_READY=$(kubectl get deployment minio -n openbrain \
  -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
if [[ "${MINIO_READY:-0}" -lt 1 ]]; then
  echo "ERROR: MinIO deployment is not ready (readyReplicas: ${MINIO_READY:-0})." >&2
  exit 1
fi

echo "    openbrain-0: Running   MinIO: Ready"

# ---------------------------------------------------------------------------
# Step 4: Resolve passphrase
# ---------------------------------------------------------------------------

if [[ -z "${BACKUP_PASSPHRASE:-}" ]] && [[ -n "${BACKUP_PASSPHRASE_FILE:-}" ]]; then
  if [[ ! -f "$BACKUP_PASSPHRASE_FILE" ]]; then
    echo "ERROR: BACKUP_PASSPHRASE_FILE not found: $BACKUP_PASSPHRASE_FILE" >&2
    exit 1
  fi
  BACKUP_PASSPHRASE=$(< "$BACKUP_PASSPHRASE_FILE")
fi

if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
  BACKUP_PASSPHRASE=$(security find-generic-password \
    -a ob1-backup -s ob1-backup-passphrase -w 2>/dev/null || true)
fi

if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
  echo "(Paste or type, then press Enter — input is hidden.)"
  read -rsp "Backup passphrase: " BACKUP_PASSPHRASE
  echo ""
  if [[ -z "$BACKUP_PASSPHRASE" ]]; then
    echo "ERROR: Passphrase cannot be empty." >&2
    exit 1
  fi
fi
export BACKUP_PASSPHRASE

# ---------------------------------------------------------------------------
# Step 5: Decrypt and extract to staging area
# ---------------------------------------------------------------------------

echo ""
echo "==> Decrypting archive..."
STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT

if ! openssl enc -aes-256-cbc -pbkdf2 -d -iter 100000 \
  -in  "$ENCRYPTED_ARCHIVE" \
  -out "$STAGING/backup.tar.gz" \
  -pass env:BACKUP_PASSPHRASE; then
  echo "ERROR: Decryption failed. Wrong passphrase, or archive is corrupted." >&2
  exit 1
fi

echo "==> Extracting..."
tar -xzf "$STAGING/backup.tar.gz" -C "$STAGING"

BACKUP_DIR=$(find "$STAGING" -mindepth 1 -maxdepth 1 -type d | head -1)
if [[ -z "$BACKUP_DIR" || ! -d "$BACKUP_DIR" ]]; then
  echo "ERROR: Could not locate backup directory after extraction." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 6: Show MANIFEST and require explicit confirmation
# ---------------------------------------------------------------------------

echo ""
echo "============================================================"
cat "$BACKUP_DIR/MANIFEST.txt"
echo "============================================================"
echo ""
echo "WARNING: This will REPLACE all current PostgreSQL data and MinIO objects."
echo "         Current data cannot be recovered after this point."
echo ""
read -rp "Type YES to proceed with restore: " CONFIRM
if [[ "$CONFIRM" != "YES" ]]; then
  echo "Restore cancelled."
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 7: Restore PostgreSQL
# ---------------------------------------------------------------------------

echo ""
echo "==> [1/3] Restoring PostgreSQL..."

kubectl exec openbrain-0 -n openbrain -- \
  sh -c "PGPASSWORD='${DB_PASSWORD}' psql -U ${DB_USER} -c 'DROP DATABASE IF EXISTS ${DB_NAME};'"

kubectl exec openbrain-0 -n openbrain -- \
  sh -c "PGPASSWORD='${DB_PASSWORD}' psql -U ${DB_USER} -c 'CREATE DATABASE ${DB_NAME};'"

kubectl exec -i openbrain-0 -n openbrain -- \
  sh -c "PGPASSWORD='${DB_PASSWORD}' psql -U ${DB_USER} ${DB_NAME}" \
  < "$BACKUP_DIR/postgres/openbrain.sql"

echo "    PostgreSQL restored."

# ---------------------------------------------------------------------------
# Step 8: Restore MinIO
# ---------------------------------------------------------------------------

echo "==> [2/3] Restoring MinIO bucket '${MINIO_BUCKET}'..."

MINIO_LOCAL_PORT=19000
kubectl port-forward svc/minio -n openbrain "${MINIO_LOCAL_PORT}:9000" &>/dev/null &
MINIO_PF_PID=$!
# Extend the EXIT trap to also kill the port-forward
trap 'kill "$MINIO_PF_PID" 2>/dev/null; rm -rf "$STAGING"' EXIT

for i in 1 2 3 4 5; do
  sleep 1
  if curl -sf "http://localhost:${MINIO_LOCAL_PORT}/minio/health/live" &>/dev/null; then
    break
  fi
  if [[ $i -eq 5 ]]; then
    echo "ERROR: MinIO port-forward did not become ready on :${MINIO_LOCAL_PORT}." >&2
    exit 1
  fi
done

mc alias set ob1rst "http://localhost:${MINIO_LOCAL_PORT}" \
  "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" \
  --api S3v4 >/dev/null 2>&1

# Remove existing bucket contents and recreate clean
mc rb --force "ob1rst/${MINIO_BUCKET}" 2>/dev/null || true
mc mb "ob1rst/${MINIO_BUCKET}"

mc mirror "$BACKUP_DIR/minio/${MINIO_BUCKET}/" "ob1rst/${MINIO_BUCKET}" --overwrite

echo "    MinIO restored."

# ---------------------------------------------------------------------------
# Step 9: Post-restore verification (port-forward still active for mc ls)
# ---------------------------------------------------------------------------

echo ""
echo "==> [3/3] Verifying restore..."

MANIFEST_PG_LINES=$(grep "PostgreSQL dump lines:" "$BACKUP_DIR/MANIFEST.txt" \
  | awk '{print $NF}' || echo "?")
MANIFEST_MINIO=$(grep "MinIO object files:" "$BACKUP_DIR/MANIFEST.txt" \
  | awk '{print $NF}' || echo "?")

# Row counts for key tables
PG_COUNTS=$(kubectl exec openbrain-0 -n openbrain -- \
  sh -c "PGPASSWORD='${DB_PASSWORD}' psql -U ${DB_USER} ${DB_NAME} -t -A -c \"
    SELECT
      (SELECT COUNT(*) FROM js_applications)    AS applications,
      (SELECT COUNT(*) FROM js_files)           AS files,
      (SELECT COUNT(*) FROM thoughts)           AS thoughts,
      (SELECT COUNT(*) FROM js_ingested_positions) AS ingested_positions
  \"" 2>/dev/null || echo "query failed")

RESTORED_MINIO=$(mc ls --recursive "ob1rst/${MINIO_BUCKET}" 2>/dev/null | wc -l | tr -d ' ')

# Port-forward no longer needed
kill "$MINIO_PF_PID" 2>/dev/null || true
trap 'rm -rf "$STAGING"' EXIT

echo ""
echo "  PostgreSQL row counts (applications | files | thoughts | ingested_positions):"
echo "    $PG_COUNTS"
echo ""
echo "  MinIO objects — backup captured: $MANIFEST_MINIO   restored: $RESTORED_MINIO"
echo "  PostgreSQL dump lines in backup: $MANIFEST_PG_LINES"
echo ""

if [[ "$RESTORED_MINIO" != "$MANIFEST_MINIO" ]]; then
  echo "  NOTICE: MinIO object count mismatch. Investigate with: mc ls --recursive ob1rst/${MINIO_BUCKET}"
fi

echo "==> Restore complete."
echo "    Verify OB1 is responding: kubectl get pods -n openbrain"
echo "    Run the deployment test suite: source .env && bash integrations/ob1/tests/test-deployment.sh"
