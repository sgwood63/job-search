# OB1 Job Search Extension

Job search extension for OB1 — manages all applicant content in Kubernetes.

For a higher-level overview of all deployment options (local, Docker Compose, K8s, OB1 default deployment) and a decision guide, see [DEPLOYMENT.md](../../DEPLOYMENT.md).

## Contents

- [What This Is](#what-this-is)
- [Prerequisites](#prerequisites)
- [Directory Layout](#directory-layout)
- [Setup Order](#setup-order)
  - [1. Configure `.env` and `.env.services`](#1-configure-env-and-envservices)
  - [1b. Python virtual environment](#1b-python-virtual-environment)
  - [2. Install nginx Ingress Controller](#2-install-nginx-ingress-controller-one-time-per-cluster)
  - [3. Deploy OB1 (PostgreSQL)](#3-deploy-ob1-postgresql)
  - [4. Apply the Ingress](#4-apply-the-ingress)
  - [5. Expose PostgreSQL for cluster-internal access](#5-expose-postgresql-for-cluster-internal-access)
  - [6. Apply the full schema](#6-apply-the-full-schema)
  - [7. MinIO Setup](#7-minio-setup)
  - [8. Build and deploy job-search-mcp](#8-build-and-deploy-job-search-mcp)
  - [9. Configure Claude Code MCP](#9-configure-claude-code-mcp)
  - [10. Run migration](#10-run-migration)
- [Docker Compose Alternative](#docker-compose-alternative)
- [Accessing Services Locally](#accessing-services-locally)
- [Unit Tests (host-side, no cluster required)](#unit-tests-host-side-no-cluster-required)
- [Verify Deployment](#verify-deployment)
- [Environment Variables](#environment-variables)

## What This Is

This directory contains the files needed to deploy the job search system as a companion service alongside a local Kubernetes deployment of OB1 (Open Brain). After setup:

- All applicant files (notes, JDs, PDFs) live in **MinIO** (object store)
- All structured state (pipeline, contacts, interviews) lives in **PostgreSQL** (OB1's database, `js_*` tables)
- Semantic search across all content via **pgvector** (OB1's `thoughts` table, tagged `source: job-search-mcp`)
- The job-search-mcp service runs as a separate Kubernetes Deployment with all 34 MCP tools, including the OB1-compat search/fetch/thought_stats tools

## Prerequisites

| Requirement | Notes |
|---|---|
| kubectl | Kubernetes CLI |
| helm | For nginx Ingress Controller installation |
| Docker | Image builds; Docker Desktop provides a local k8s cluster |
| Python 3 + venv | MinIO bucket creation and migration (`pip install psycopg2-binary minio`) |

## Directory Layout

```
integrations/ob1/
├── README.md                       (this file)
├── full-schema.sql                 (authoritative 3-layer schema: thoughts+pgvector, entities+edges, js_*)
├── job-search-schema.sql           (js_* tables — Layer 3 of full-schema.sql; use full-schema.sql for fresh deploys)
├── job-search-tools.ts             (34 MCP tools: 31 job-search + 3 OB1-compat absorbed tools)
├── job-search-server.ts            (job-search-mcp entry point — single server, all tools + REST)
├── deno.json                       (import map for job-search-mcp)
├── Dockerfile                      (builds the job-search-mcp image — no OB1 repo dependency)
├── docker-compose.yml              (all OB1 services — K8s-free alternative)
├── k8s/
│   ├── openbrain.yml               (OB1 StatefulSet — db container only; MCP + langfuse-proxy removed)
│   ├── openbrain-db-service.yml    (exposes OB1 PostgreSQL on port 5432 for job-search-mcp access)
│   ├── ingress.yml                 (nginx Ingress — /job-search and /minio paths only)
│   ├── minio-configmap.yml         (non-sensitive MinIO server config)
│   ├── minio.yml                   (MinIO Deployment + ClusterIP Service — no external exposure)
│   ├── job-search-configmap.yml    (non-sensitive config: cluster DNS, model names, ports, CITATION_BASE_URL)
│   ├── job-search.yml              (job-search-mcp Deployment + ClusterIP Service)
└── tests/
    ├── test-deployment.sh          (deployment verification)
    ├── test-ob1-tools.ts           (Deno unit tests: search, fetch, thought_stats + BigInt safety)
    ├── test-knowledge-graph.ts     (Deno unit tests: create_knowledge_edge, get_entity_neighbors)
    ├── test-search-thoughts.ts     (Deno unit tests: search_thoughts, list_thoughts)
    └── test-chunking.ts            (Deno unit tests: HTML/DOCX/PDF extraction + markdown chunking)
```

## Setup Order

### 1. Configure `.env` and `.env.services`

Credentials are split across two gitignored files. Copy both templates and fill them in:

```bash
# Run from the repo root ($APP_DIR), not from integrations/ob1/
cp .env.example .env
cp .env.services.example .env.services
# Edit both files — .env for Claude CLI config, .env.services for storage credentials
```

| File | Contents |
|------|----------|
| `.env` | Claude CLI config: paths, MCP access key (`JOB_SEARCH_MCP_KEY`), `DATA_BACKEND` |
| `.env.services` | Storage credentials: MinIO, PostgreSQL, LLM API keys, `ANTHROPIC_API_DEPLOYMENT_KEY` |

Load both into your shell (re-run in any new terminal session):

```bash
source .env
source .env.services
```

All commands in this guide use `$VARIABLE_NAME` references — they resolve correctly as long as both files are sourced. See `.env.example` and `.env.services.example` for the full annotated lists.

Then push all credentials and config to Kubernetes:

```bash
bash scripts/k8s-apply-env.sh
```

This reads from both `.env` and `.env.services` to create `openbrain-secret`, `openbrain-configmap`, `minio-secret`, `job-search-secret`, `job-search-llm-config`, and `webapp-secret` in the `openbrain` namespace. Re-run after any credential or config change (takes effect on next pod restart).

### 1b. Python virtual environment

Required for MinIO bucket creation (step 7) and migration (step 10). Create once:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --quiet psycopg2-binary minio
python3 -c "import minio, psycopg2; print('deps OK')"
```

### 2. Install nginx Ingress Controller (one-time, per cluster)

All HTTP services are accessed through an nginx Ingress — no per-session port-forwarding required.

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.service.type=LoadBalancer
```

**Environment-specific notes for accessing port 80:**
- **Docker Desktop** — `EXTERNAL-IP: localhost` is assigned automatically; no extra steps.
- **minikube** — run `minikube tunnel` in a separate terminal to get `localhost` as the external IP.
- **kind** — configure metallb or add port mappings to the kind cluster config before installing.
- **Cloud (EKS/GKE/AKS)** — a cloud load balancer is provisioned automatically; use its external IP.

Verify the controller has an external IP before proceeding:

```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller
# EXTERNAL-IP should be "localhost" (Docker Desktop/minikube) or a cloud IP
```

### 3. Deploy OB1 (PostgreSQL)

No image build required — the db container uses `postgres:16` from Docker Hub. The `openbrain.yml` manifest here is self-contained; do **not** apply any manifest from the OB1 repo.

```bash
kubectl apply -f integrations/ob1/k8s/openbrain.yml
```

### 4. Apply the Ingress

Route `/job-search` and `/minio` paths through the nginx Ingress controller:

```bash
kubectl apply -f integrations/ob1/k8s/ingress.yml
```

Apply this before testing any service — nginx handles missing backends gracefully until later steps bring them up.

### 5. Expose PostgreSQL for cluster-internal access

Create the `openbrain-db` ClusterIP Service so job-search-mcp can reach PostgreSQL at `openbrain-db.openbrain.svc.cluster.local:5432`:

```bash
kubectl apply -f integrations/ob1/k8s/openbrain-db-service.yml
```

### 6. Apply the full schema

`full-schema.sql` is the authoritative, idempotent schema for all three layers — no OB1 repo needed:

```bash
kubectl cp integrations/ob1/full-schema.sql openbrain/openbrain-0:/tmp/schema.sql -c db
kubectl exec -n openbrain openbrain-0 -c db -- psql -U postgres -d openbrain -f /tmp/schema.sql
```

This applies in dependency order:
- **Layer 1:** `thoughts` table + pgvector extension + `match_thoughts()` function (idempotent — already created by `openbrain.yml` init SQL)
- **Layer 2:** `entities`, `edges`, `thought_entities` tables for the knowledge graph (no OB1 repo dependency)
- **Layer 3:** all `js_*` tables + Phase 3 composite indexes

Safe to re-run on an existing deployment — all statements use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`.

### 7. MinIO Setup

1. Apply MinIO config:

   ```bash
   kubectl apply -f integrations/ob1/k8s/minio-configmap.yml
   kubectl apply -f integrations/ob1/k8s/minio.yml
   ```

2. Create the `job-search` bucket:

   MinIO is ClusterIP-only — start a port-forward first:
   ```bash
   kubectl port-forward svc/minio -n openbrain 9000:9000 &
   ```

   **Option A — MinIO Client (`mc`):**
   ```bash
   brew install minio/stable/mc
   mc alias set local http://localhost:9000 "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"
   mc mb local/job-search
   ```

   **Option B — Web console:**
   ```bash
   open http://localhost/minio
   ```

   **Option C — Python (using `.venv` from step 1b):**
   ```bash
   source .venv/bin/activate && source .env && source .env.services
   python3 -c "
   from minio import Minio; import os
   c = Minio(os.environ['MINIO_ENDPOINT'], os.environ['MINIO_ACCESS_KEY'], os.environ['MINIO_SECRET_KEY'], secure=False)
   if not c.bucket_exists(os.environ['MINIO_BUCKET']):
       c.make_bucket(os.environ['MINIO_BUCKET'])
       print('bucket created')
   else:
       print('already exists')
   "
   ```

### 8. Build and deploy job-search-mcp

1. Apply the ConfigMap:

   ```bash
   kubectl apply -f integrations/ob1/k8s/job-search-configmap.yml
   ```

2. Build the Docker image:

   ```bash
   docker build -t job-search-mcp:latest integrations/ob1/

   # For K3s:
   docker save job-search-mcp:latest | sudo k3s ctr images import -

   # For minikube:
   minikube image load job-search-mcp:latest

   # For other clusters, push to your registry:
   docker tag job-search-mcp:latest your-registry/job-search-mcp:latest
   docker push your-registry/job-search-mcp:latest
   ```

3. Deploy:

   ```bash
   kubectl apply -f integrations/ob1/k8s/job-search.yml
   ```

4. Verify:

   ```bash
   kubectl get pods -n openbrain
   kubectl logs -n openbrain -l app=job-search-mcp
   ```

### 9. Configure Claude Code MCP

`.mcp.json` is generated automatically by `bash scripts/k8s-apply-env.sh` (step 1) — no manual editing required. It is gitignored; the file is recreated from `.env` each time you run the script.

The server uses the **Streamable HTTP** MCP transport. Claude Code requires `"type": "http"` in `.mcp.json` and the URL must point to the `/mcp` endpoint. Authentication is via `x-brain-key` header. After the file is written, restart Claude Code (or reload the VS Code window) for the MCP server to register.

**Verify connectivity** before running migration (expect 34 tools):

```bash
source .env

# job-search MCP — expect 34 tools
curl -s "$JOB_SEARCH_MCP_URL/mcp" \
  -H "x-brain-key: $JOB_SEARCH_MCP_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  | grep '^data:' | head -1 | python3 -m json.tool | grep '"name"' | wc -l

# If 401: key mismatch — re-run bash scripts/k8s-apply-env.sh
```

### 10. Run migration

Migrate existing local applicant files to OB1. The migration script connects directly to `localhost:5432` — ensure the PostgreSQL port-forward is running first (see "Accessing Services Locally" → "PostgreSQL Port-Forward").

```bash
source .venv/bin/activate && source .env && source .env.services
python scripts/migrate-to-ob1.py --dry-run   # preview — check for parse errors first
python scripts/migrate-to-ob1.py             # full run
```

## Docker Compose Alternative

`integrations/ob1/docker-compose.yml` runs the same 4 services (postgres, minio, openbrain MCP, job-search-mcp) without a Kubernetes cluster. Use this for lighter local development or when Docker Desktop K8s is unavailable.

### Env Overrides for Compose Mode

Some values differ from K8s defaults. In `.env` (Claude CLI config):

```bash
DATA_BACKEND=ob1
JOB_SEARCH_MCP_URL=http://localhost:8081
JOB_SEARCH_REST_URL=http://job-search-mcp:8001   # webapp REST client (compose service name)
```

In `.env.services` (storage credentials):

```bash
DB_HOST=postgres              # compose service name (not localhost or cluster DNS)
MINIO_ENDPOINT=minio:9000     # compose service name (not localhost)
```

Then regenerate `.mcp.json`:

```bash
bash scripts/k8s-apply-env.sh
```

### Running

Use `bash scripts/start-ob1.sh` — it sources both `.env` and `.env.services` before invoking `docker compose`, so all `${VARNAME}` interpolations in the compose YAML resolve correctly.

```bash
# OB1 services only
bash scripts/start-ob1.sh up -d

# Apply schema once (first run only)
bash scripts/start-ob1.sh exec postgres \
  psql -U postgres -d openbrain < integrations/ob1/full-schema.sql

# Full stack with webapp
docker compose -f webapp/docker-compose.yml up -d &
bash scripts/start-ob1.sh up -d
```

### Service Access (compose mode)

| Service | URL | Notes |
|---|---|---|
| job-search MCP | `http://localhost:8081/mcp` | Used by Claude Code `.mcp.json` |
| OB1 REST API | `http://localhost:8081/ob1/rest/*` | Dashboard-compat REST routes (same server) |
| OB1 Dashboard | `http://localhost:3000` | Next.js browser UI for OB1 thoughts |
| MinIO S3 API | `http://localhost:9000` | S3 SDK access |
| MinIO console | `http://localhost:9001` | Web UI — bucket management |
| PostgreSQL | `localhost:5432` | Direct DB access (no port-forward needed) |
| Webapp (if combined) | `http://localhost:8000` | React + FastAPI |

---

## Accessing Services Locally

Most services are permanently accessible once the Ingress controller and manifests are applied. PostgreSQL requires a persistent port-forward that must be running whenever the webapp or any tool that connects directly to the database is active.

| Service | URL | Notes |
|---|---|---|
| job-search MCP | `http://localhost/job-search/mcp` | Used by Claude Code `.mcp.json`; base path `/job-search` returns 401 |
| job-search REST API | `http://localhost/job-search/api/v2/*` | Used by the webapp; auth via `x-brain-key` header |
| OB1 REST API | `http://localhost/job-search/ob1/rest/*` | Dashboard-compat REST routes; auth via `x-brain-key` header |
| MinIO console | `http://localhost/minio` | Web UI — bucket management |
| MinIO S3 API | `localhost:9000` (port-forward) | `kubectl port-forward svc/minio -n openbrain 9000:9000` — for `mc` / S3 SDK admin access only |
| PostgreSQL | `localhost:5432` | Requires port-forward — needed for `migrate-to-ob1.py` only |

### PostgreSQL Port-Forward

Required for `migrate-to-ob1.py`. The webapp no longer connects directly to PostgreSQL — it routes all data access through the job-search-mcp REST API (`/api/v2/*`). Start this forward only when running the migration script:

```bash
kubectl port-forward svc/openbrain-db -n openbrain 5432:5432 &
```

To restart after a disconnect:

```bash
pkill -f "kubectl port-forward svc/openbrain-db" 2>/dev/null || true
kubectl port-forward svc/openbrain-db -n openbrain 5432:5432 &
```

> **Webapp users:** no port-forward needed for normal webapp use. The webapp calls the job-search-mcp REST API (`JOB_SEARCH_REST_URL`), which handles all Postgres queries internally.

## Unit Tests (host-side, no cluster required)

The TypeScript unit tests in `tests/` run on the host machine via Deno. Deno is installed at `~/.deno/bin/deno` and is **not** on the system PATH — always invoke via `$DENO_BIN` (set in `.env`):

```bash
source .env  # loads $DENO_BIN

# OB1-compat tools (search, fetch, thought_stats) + BigInt safety
$DENO_BIN test --no-check --allow-env --allow-sys tests/test-ob1-tools.ts

# Chunking (HTML/DOCX/PDF → markdown → chunks)
$DENO_BIN test --allow-net --allow-read --allow-env tests/test-chunking.ts

# Knowledge graph edges (entity resolution, create_knowledge_edge, get_entity_neighbors)
$DENO_BIN test --allow-net --allow-read --allow-env tests/test-knowledge-graph.ts

# Thought search (search_thoughts, list_thoughts with thought IDs)
$DENO_BIN test --allow-net --allow-read --allow-env tests/test-search-thoughts.ts
```

> **Never use bare `deno test ...`** — it will fail with `command not found` because `~/.deno/bin` is not in PATH.

---

## Verify Deployment

Run the full test suite (namespace, secrets, pods, Postgres, 9 js_* tables, MinIO bucket, ingress, single MCP server with 34 tools, OB1-compat tool verification, and functional tool round-trips):

```bash
bash integrations/ob1/tests/test-deployment.sh
```

Run a single test by name:

```bash
bash integrations/ob1/tests/test-deployment.sh test_js_tables
```

Non-default base URL (minikube, k3d, cloud):

```bash
K8S_BASE_URL=http://$(minikube ip) bash integrations/ob1/tests/test-deployment.sh
```

Exit 0 = all assertions pass. Exit 1 = one or more failures (check the color-coded output).

---

## Environment Variables

Credentials are split across two gitignored files — see `.env.example` and `.env.services.example` for the full annotated templates.

| File | Contains |
|------|----------|
| `.env` | Claude CLI config: paths, MCP access key (`JOB_SEARCH_MCP_KEY`), `DATA_BACKEND` |
| `.env.services` | Storage credentials: MinIO, PostgreSQL, LLM API keys, `ANTHROPIC_API_DEPLOYMENT_KEY` |

**Why the split:** Claude's shell inherits exported vars. Keeping storage credentials out of `.env` means Claude cannot reach MinIO or Postgres directly — all applicant data must flow through OB1 MCP tools. See [memory/feedback_ob1_integration.md](../../memory/feedback_ob1_integration.md).

### Variables by file

**`.env`** (Claude CLI — sourced by Claude Code shell):

| Variable | Where used | Notes |
|----------|-----------|-------|
| `JOB_SEARCH_MCP_URL` | Claude Code `.mcp.json` | K8s: `http://localhost/job-search` (via Ingress) · Compose: `http://localhost:8081` |
| `JOB_SEARCH_MCP_KEY` | k8s `webapp-secret` → `MCP_ACCESS_KEY`; webapp | Auth header for job-search MCP and REST API |
| `JOB_SEARCH_REST_URL` | Webapp (`ObRestClient`) | K8s: set in `webapp-configmap.yml` · Compose: `http://job-search-mcp:8001` · Local dev: `http://localhost:8001` |
| `DATA_BACKEND` | Webapp, Claude Code | `ob1` when OB1 services are running |

**`.env.services`** (storage credentials — NOT sourced by Claude Code shell):

| Variable | Where used | Notes |
|----------|-----------|-------|
| `OBJECT_STORE_BACKEND` | job-search-tools.ts | `minio` or `supabase` |
| `MINIO_ENDPOINT` | job-search-tools.ts | `localhost:9000` (port-forward, admin/migration use only); `minio:9000` in compose; `minio.openbrain.svc.cluster.local:9000` cluster-internal |
| `MINIO_ACCESS_KEY` | job-search-tools.ts, k8s Secret | |
| `MINIO_SECRET_KEY` | job-search-tools.ts, k8s Secret | |
| `MINIO_BUCKET` | job-search-tools.ts | `job-search` |
| `MINIO_SECURE` | job-search-tools.ts | `false` for local K8s |
| `DB_HOST` | job-search-server.ts | `localhost` locally; `postgres` in compose; cluster DNS in k8s ConfigMap |
| `DB_PORT` | job-search-server.ts | `5432` |
| `DB_NAME` | job-search-server.ts | `openbrain` |
| `DB_USER` | job-search-server.ts | `postgres` |
| `DB_PASSWORD` | job-search-server.ts, k8s Secret | |
| `LLM_API_KEY` | k8s Secret → `EMBEDDING_API_KEY`, `CHAT_API_KEY` in `job-search-secret` | OpenRouter or OpenAI key |
| `EMBEDDING_API_BASE` | `job-search-llm-config` ConfigMap → job-search-mcp | Default: `https://openrouter.ai/api/v1`; OpenAI: `https://api.openai.com/v1` |
| `EMBEDDING_MODEL` | `job-search-llm-config` ConfigMap → job-search-mcp | Default: `openai/text-embedding-3-small`; OpenAI: `text-embedding-3-small` |
| `CHAT_API_BASE` | `job-search-llm-config` ConfigMap → job-search-mcp | Default: `https://openrouter.ai/api/v1`; OpenAI: `https://api.openai.com/v1` |
| `CHAT_MODEL` | `job-search-llm-config` ConfigMap → job-search-mcp | Default: `openai/gpt-4o-mini`; OpenAI: `gpt-4o-mini` |
| `ANTHROPIC_API_DEPLOYMENT_KEY` | k8s `webapp-secret` → `ANTHROPIC_API_KEY` | Container-only; not needed for local Claude Code (uses OAuth) |

Supabase alternative (if `OBJECT_STORE_BACKEND=supabase`): set `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET` in `.env.services` instead of the MinIO vars.

### K8s resources created by `k8s-apply-env.sh`

**k8s Secret** (`job-search-secret`) — 6 sensitive vars from `.env.services`. Never edit the Secret YAML directly.

**k8s ConfigMap** (`job-search-configmap.yml`) — non-sensitive subset with cluster-internal DNS names; overrides localhost values inside the cluster.

**`job-search-llm-config` ConfigMap** — 4 LLM API settings from `.env.services`. Defaults to OpenRouter; override for OpenAI. Re-running the script after any change takes effect on next pod restart.

**`openbrain-secret`** — 1 key for the OB1 StatefulSet db container: `postgres-password` (`$DB_PASSWORD`). The MCP server and langfuse-proxy containers have been removed from `openbrain.yml` — no LLM keys or MCP access keys are stored here. Do not apply the OB1 repo's `secrets.yml`.

**`openbrain-configmap`** — DB connection vars (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`) for the PostgreSQL db container in the openbrain StatefulSet.

> **Note:** The `dashboard-secret` (SESSION_SECRET) has been removed. The ob1-dashboard standalone deployment has been retired and its functionality (thoughts search + stats) is now built into the webapp at `/thoughts`.
