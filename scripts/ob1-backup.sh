#!/usr/bin/env bash
# ob1-backup.sh — Point-in-time backup of OB1 data (PostgreSQL + MinIO) to Google Drive.
#
# Prerequisites (install if missing):
#   kubectl  — brew install kubectl
#   mc       — brew install minio/stable/mc
#   openssl  — pre-installed on macOS
#   tar      — pre-installed on macOS
#
# Passphrase resolution (in order):
#   1. BACKUP_PASSPHRASE environment variable
#   2. BACKUP_PASSPHRASE_FILE environment variable (path to a file containing the passphrase)
#   3. macOS Keychain (stored by a previous run):
#        security find-generic-password -a ob1-backup -s ob1-backup-passphrase -w
#   4. Interactive prompt — type or paste, then press Enter (offers to save to Keychain)
#
# Usage:
#   bash scripts/ob1-backup.sh
#
# Output:
#   <Google Drive>/ob1-backups/ob1-backup-YYYY-MM-DD-HHMMSS.tar.gz.enc
#
# Override backup destination:
#   OB1_BACKUP_DEST=/your/path bash scripts/ob1-backup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# Step 1: Source credentials
# ---------------------------------------------------------------------------

ENV_FILE="$APP_DIR/.env"
ENV_SERVICES="$APP_DIR/.env.services"

if [[ ! -f "$ENV_SERVICES" ]]; then
  echo "ERROR: .env.services not found at $ENV_SERVICES" >&2
  echo "       Copy .env.services.example and fill in your credentials." >&2
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

# shellcheck disable=SC1090
source "$ENV_SERVICES"

# ---------------------------------------------------------------------------
# Step 2: Prerequisites check
# ---------------------------------------------------------------------------

MISSING=()
for TOOL in kubectl mc openssl tar date; do
  if ! command -v "$TOOL" &>/dev/null; then
    MISSING+=("$TOOL")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "ERROR: Missing required tools: ${MISSING[*]}" >&2
  echo "" >&2
  echo "Install instructions:" >&2
  echo "  kubectl → brew install kubectl" >&2
  echo "  mc      → brew install minio/stable/mc" >&2
  echo "  openssl → pre-installed on macOS; update via: brew install openssl" >&2
  exit 1
fi

echo "==> Checking OB1 services..."

if ! kubectl get ns openbrain &>/dev/null; then
  echo "ERROR: Cannot reach Kubernetes namespace 'openbrain'." >&2
  echo "       Verify your cluster is running: kubectl get nodes" >&2
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
# Step 3: Resolve backup passphrase
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
  echo ""
  echo "No backup passphrase found. Enter one to encrypt this archive."
  echo "(Paste or type, then press Enter — input is hidden.)"
  read -rsp "Passphrase: " BACKUP_PASSPHRASE
  echo ""

  if [[ -z "$BACKUP_PASSPHRASE" ]]; then
    echo "ERROR: Passphrase cannot be empty." >&2
    exit 1
  fi

  read -rp "Save passphrase to macOS Keychain for future runs? [y/N] " SAVE_KEY
  if [[ "$SAVE_KEY" == "y" || "$SAVE_KEY" == "Y" ]]; then
    security add-generic-password \
      -a ob1-backup -s ob1-backup-passphrase -w "$BACKUP_PASSPHRASE"
    echo "    Saved. Retrieve later with:"
    echo "    security find-generic-password -a ob1-backup -s ob1-backup-passphrase -w"
  fi
fi
export BACKUP_PASSPHRASE

# ---------------------------------------------------------------------------
# Step 4: Create staging area
# ---------------------------------------------------------------------------

TIMESTAMP=$(date +%Y-%m-%d-%H%M%S)
BACKUP_NAME="ob1-backup-$TIMESTAMP"
STAGING=$(mktemp -d)
SNAPSHOT="$STAGING/$BACKUP_NAME"
mkdir -p "$SNAPSHOT/postgres" "$SNAPSHOT/minio" "$SNAPSHOT/config"

trap 'rm -rf "$STAGING"' EXIT

echo ""
echo "==> Snapshot: $BACKUP_NAME"

# ---------------------------------------------------------------------------
# Step 5: Dump PostgreSQL (runs pg_dump inside the pod — no local install needed)
# ---------------------------------------------------------------------------

echo "==> [1/4] Dumping PostgreSQL database '${DB_NAME}'..."

kubectl exec openbrain-0 -n openbrain -- \
  sh -c "PGPASSWORD='${DB_PASSWORD}' pg_dump -U ${DB_USER} ${DB_NAME}" \
  > "$SNAPSHOT/postgres/openbrain.sql"

PG_LINES=$(wc -l < "$SNAPSHOT/postgres/openbrain.sql" | tr -d ' ')
if [[ "$PG_LINES" -lt 10 ]]; then
  echo "ERROR: PostgreSQL dump is unexpectedly small ($PG_LINES lines). Aborting." >&2
  exit 1
fi
echo "    Dump: $PG_LINES lines."

# ---------------------------------------------------------------------------
# Step 6: Mirror MinIO bucket (via kubectl port-forward — MinIO is ClusterIP)
# ---------------------------------------------------------------------------

echo "==> [2/4] Mirroring MinIO bucket '${MINIO_BUCKET}'..."

MINIO_LOCAL_PORT=19000
kubectl port-forward svc/minio -n openbrain "${MINIO_LOCAL_PORT}:9000" &>/dev/null &
MINIO_PF_PID=$!
# Extend the EXIT trap to also kill the port-forward
trap 'kill "$MINIO_PF_PID" 2>/dev/null; rm -rf "$STAGING"' EXIT

# Wait for port-forward to be ready
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

mc alias set ob1bkp "http://localhost:${MINIO_LOCAL_PORT}" \
  "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" \
  --api S3v4 >/dev/null 2>&1

mc mirror "ob1bkp/${MINIO_BUCKET}" "$SNAPSHOT/minio/${MINIO_BUCKET}/"

kill "$MINIO_PF_PID" 2>/dev/null || true
trap 'rm -rf "$STAGING"' EXIT

MINIO_FILES=$(find "$SNAPSHOT/minio" -type f | wc -l | tr -d ' ')
echo "    Objects: $MINIO_FILES files."

# ---------------------------------------------------------------------------
# Step 7: Copy config files
# ---------------------------------------------------------------------------

echo "==> [3/4] Capturing config..."
cp "$ENV_SERVICES" "$SNAPSHOT/config/env.services"
[[ -f "$ENV_FILE" ]] && cp "$ENV_FILE" "$SNAPSHOT/config/env"

# ---------------------------------------------------------------------------
# Step 8: Write MANIFEST
# ---------------------------------------------------------------------------

cat > "$SNAPSHOT/MANIFEST.txt" <<EOF
ob1-backup MANIFEST
===================
Timestamp:              $TIMESTAMP
K8s namespace:          openbrain
PostgreSQL host/db:     ${DB_HOST}:${DB_PORT} / ${DB_NAME}
PostgreSQL user:        ${DB_USER}
MinIO bucket:           ${MINIO_BUCKET}

Counts (for restore verification):
  PostgreSQL dump lines:  $PG_LINES
  MinIO object files:     $MINIO_FILES
EOF

# ---------------------------------------------------------------------------
# Step 9: Compress
# ---------------------------------------------------------------------------

echo "==> [4/4] Compressing and encrypting..."
tar -czf "$STAGING/$BACKUP_NAME.tar.gz" -C "$STAGING" "$BACKUP_NAME"
COMPRESSED=$(du -sh "$STAGING/$BACKUP_NAME.tar.gz" | cut -f1)
echo "    Compressed:  $COMPRESSED"

# ---------------------------------------------------------------------------
# Step 10: Encrypt (AES-256-CBC, PBKDF2, 100k iterations)
# ---------------------------------------------------------------------------

openssl enc -aes-256-cbc -pbkdf2 -iter 100000 \
  -in  "$STAGING/$BACKUP_NAME.tar.gz" \
  -out "$STAGING/$BACKUP_NAME.tar.gz.enc" \
  -pass env:BACKUP_PASSPHRASE

rm "$STAGING/$BACKUP_NAME.tar.gz"
ENCRYPTED=$(du -sh "$STAGING/$BACKUP_NAME.tar.gz.enc" | cut -f1)
echo "    Encrypted:   $ENCRYPTED"

# ---------------------------------------------------------------------------
# Step 11: Move to destination (default: Google Drive ob1-backups/ folder)
# ---------------------------------------------------------------------------

if [[ -n "${OB1_BACKUP_DEST:-}" ]]; then
  DEST_DIR="$OB1_BACKUP_DEST"
else
  # Derive from APPLICANT_DIR: sibling folder named ob1-backups.
  # Works automatically when APPLICANT_DIR is inside Google Drive / OneDrive / etc.
  : "${APPLICANT_DIR:=$(dirname "$ENV_SERVICES")}"
  DEST_DIR="$(dirname "$APPLICANT_DIR")/ob1-backups"
fi

if [[ ! -d "$(dirname "$DEST_DIR")" ]]; then
  echo "ERROR: Backup destination parent does not exist: $(dirname "$DEST_DIR")" >&2
  echo "       Check that APPLICANT_DIR in .env points to an accessible path." >&2
  echo "       Override with: OB1_BACKUP_DEST=/your/path bash scripts/ob1-backup.sh" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
mv "$STAGING/$BACKUP_NAME.tar.gz.enc" "$DEST_DIR/"

ARCHIVE="$DEST_DIR/$BACKUP_NAME.tar.gz.enc"
if [[ ! -f "$ARCHIVE" ]]; then
  echo "ERROR: Archive not found at destination after move. Check permissions." >&2
  exit 1
fi

FINAL=$(du -sh "$ARCHIVE" | cut -f1)

echo ""
echo "==> Backup complete."
echo "    Archive: $ARCHIVE"
echo "    Size:    $FINAL"
echo "    Google Drive will sync this to the cloud automatically."
echo ""
echo "To restore: bash \"$SCRIPT_DIR/ob1-restore.sh\" \"$ARCHIVE\""
