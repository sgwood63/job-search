# OB1 Job Search Extension

Job search extension for OB1 — manages all applicant content in Kubernetes.

For a higher-level overview of all deployment options (local, Docker Compose, K8s, OB1 default deployment) and a decision guide, see [DEPLOYMENT.md](../../DEPLOYMENT.md).

## What This Is

This directory contains the files needed to deploy the job search system as a companion service alongside a local Kubernetes deployment of OB1 (Open Brain). After setup:

- All applicant files (notes, JDs, PDFs) live in **MinIO** (object store)
- All structured state (pipeline, contacts, interviews) lives in **PostgreSQL** (OB1's database, `js_*` tables)
- Semantic search across all content via **pgvector** (OB1's `thoughts` table, tagged `source: job-search-mcp`)
- The job-search-mcp service runs as a separate Kubernetes Deployment, leaving the OB1 image untouched

## Prerequisites

| Requirement | Notes |
|---|---|
| OB1 repo (local clone) | Required to build `openbrain-mcp-server:latest`. Set `OB1_REPO_PATH` in `.env.services` to the clone path. The image is built from `$OB1_REPO_PATH/integrations/kubernetes-deployment/`. |
| kubectl | Kubernetes CLI |
| helm | For nginx Ingress Controller installation |
| Docker | Image builds; Docker Desktop provides a local k8s cluster |
| Python 3 + venv | MinIO bucket creation and migration (`pip install psycopg2-binary minio`) |

## Directory Layout

```
integrations/ob1/
├── README.md                       (this file)
├── job-search-schema.sql           (9 SQL tables — run once against OB1 Postgres)
├── job-search-tools.ts             (17 MCP tool implementations)
├── job-search-server.ts            (job-search-mcp entry point — Deno HTTP server)
├── deno.json                       (import map for job-search-mcp)
├── Dockerfile                      (builds the job-search-mcp image)
├── docker-compose.yml              (all OB1 services — K8s-free alternative)
├── ob1-rest-pg/
│   ├── index.ts                    (PostgreSQL-backed REST API — serves the dashboard)
│   ├── deno.json                   (import map for ob1-rest-pg)
│   └── Dockerfile                  (builds the ob1-rest-pg image)
├── k8s/
│   ├── openbrain.yml               (OB1 StatefulSet — job-search-managed; use instead of OB1 repo's copy)
│   ├── openbrain-db-service.yml    (exposes OB1 PostgreSQL on port 5432 for job-search-mcp access)
│   ├── ingress.yml                 (nginx Ingress — routes /ob1, /job-search, /minio paths)
│   ├── minio-configmap.yml         (non-sensitive MinIO server config)
│   ├── minio.yml                   (MinIO Deployment + ClusterIP Service)
│   ├── minio-s3-nodeport.yml       (NodePort Service — exposes MinIO S3 API at localhost:30900)
│   ├── job-search-configmap.yml    (non-sensitive config: cluster DNS, model names, ports)
│   ├── job-search.yml              (job-search-mcp Deployment + ClusterIP Service)
│   ├── ob1-rest-pg.yml             (ob1-rest-pg Deployment + ClusterIP Service — REST API for dashboard)
│   ├── dashboard.yml               (ob1-dashboard Deployment + ClusterIP Service)
│   └── dashboard-nodeport.yml      (NodePort Service — exposes dashboard at localhost:30303)
└── tests/
    └── test-deployment.sh          (deployment verification — 19 assertions)
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
| `.env` | Claude CLI config: paths, MCP access keys (`OB1_MCP_KEY`, `JOB_SEARCH_MCP_KEY`), `DATA_BACKEND` |
| `.env.services` | Storage credentials: MinIO, PostgreSQL, LLM API keys, `ANTHROPIC_API_DEPLOYMENT_KEY`, `OB1_REPO_PATH` |

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

### 3. Deploy OB1

The job search extension ships its own `integrations/ob1/k8s/openbrain.yml` — a version of the OB1 manifest that sources all config from the `openbrain-configmap` and `openbrain-secret` created in step 1. Use this instead of the manifest in the OB1 repo. Do **not** apply OB1's `openbrain.yml` or `secrets.yml`.

1. Build the OB1 MCP server image from your OB1 checkout (`$OB1_REPO_PATH` set in `.env.services`):

   ```bash
   docker build -t openbrain-mcp-server:latest "$OB1_REPO_PATH/integrations/kubernetes-deployment/"

   # For K3s:
   docker save openbrain-mcp-server:latest | sudo k3s ctr images import -

   # For minikube:
   minikube image load openbrain-mcp-server:latest

   # For other clusters, push to your registry and update the image ref in openbrain.yml
   ```

2. Deploy:

   ```bash
   kubectl apply -f integrations/ob1/k8s/openbrain.yml
   ```

### 4. Apply the Ingress

Route `/ob1`, `/job-search`, and `/minio` paths through the nginx Ingress controller:

```bash
kubectl apply -f integrations/ob1/k8s/ingress.yml
```

Apply this before testing any service — nginx handles missing backends gracefully until later steps bring them up.

### 5. Expose PostgreSQL for cluster-internal access

The default OB1 Service only exposes the MCP port (8000). Apply this one-time patch to also expose PostgreSQL:

```bash
kubectl apply -f integrations/ob1/k8s/openbrain-db-service.yml
```

This creates `Service/openbrain-db` in the `openbrain` namespace without modifying the OB1 StatefulSet.

### 6. Apply the job search schema

```bash
kubectl cp integrations/ob1/job-search-schema.sql openbrain/openbrain-0:/tmp/schema.sql -c db
kubectl exec -n openbrain openbrain-0 -c db -- psql -U postgres -d openbrain -f /tmp/schema.sql
```

### 7. MinIO Setup

1. Apply MinIO config:

   ```bash
   kubectl apply -f integrations/ob1/k8s/minio-configmap.yml
   kubectl apply -f integrations/ob1/k8s/minio.yml
   ```

2. Apply the NodePort so MinIO is reachable locally:

   ```bash
   kubectl apply -f integrations/ob1/k8s/minio-s3-nodeport.yml
   ```

3. Create the `job-search` bucket:

   **Option A — MinIO Client (`mc`):**
   ```bash
   brew install minio/stable/mc
   mc alias set local http://localhost:30900 "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"
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

### 9. Build and deploy ob1-rest-pg

`ob1-rest-pg` is a Deno/Hono REST API that serves the dashboard. The OB1 MCP server handles only MCP protocol — it returns 406 for plain HTTP — so a separate REST service is needed for browser access.

1. Build the image:

   ```bash
   docker build -t ob1-rest-pg:latest integrations/ob1/ob1-rest-pg/

   # For K3s:
   docker save ob1-rest-pg:latest | sudo k3s ctr images import -

   # For minikube:
   minikube image load ob1-rest-pg:latest
   ```

2. Deploy:

   ```bash
   kubectl apply -f integrations/ob1/k8s/ob1-rest-pg.yml
   ```

3. Verify:

   ```bash
   kubectl get pods -n openbrain -l app=ob1-rest-pg
   ```

### 10. Build and deploy the OB1 Dashboard

The dashboard build definition lives in `integrations/ob1/docker-compose.yml` — no Dockerfile in the OB1 repo is needed. The dashboard connects to `ob1-rest-pg` (step 9), not the OB1 MCP server.

1. Add `DASHBOARD_SESSION_SECRET` to `.env.services` (generate: `openssl rand -hex 32`), then recreate secrets:

   ```bash
   bash scripts/k8s-apply-env.sh   # creates dashboard-secret
   ```

2. Build the image using docker compose (set `OB1_REPO_PATH` in `.env.services`):

   ```bash
   source .env.services
   DASHBOARD_OB1_URL=http://ob1-rest-pg.openbrain.svc.cluster.local:8002 \
     docker compose -f integrations/ob1/docker-compose.yml build dashboard

   # For K3s:
   docker save ob1-dashboard:latest | sudo k3s ctr images import -

   # For minikube:
   minikube image load ob1-dashboard:latest
   ```

3. Deploy:

   ```bash
   kubectl apply -f integrations/ob1/k8s/dashboard.yml
   kubectl apply -f integrations/ob1/k8s/dashboard-nodeport.yml
   ```

4. Verify and open:

   ```bash
   kubectl get pods -n openbrain -l app=ob1-dashboard
   open http://localhost:30303   # log in with OB1_MCP_KEY as the API key
   ```

### 11. Configure Claude Code MCP

`.mcp.json` is generated automatically by `bash scripts/k8s-apply-env.sh` (step 1) — no manual editing required. It is gitignored; the file is recreated from `.env` each time you run the script.

Both servers use the **Streamable HTTP** MCP transport. Claude Code requires `"type": "http"` in `.mcp.json` and the URL must point to the `/mcp` endpoint. Authentication is via `x-brain-key` header. After the file is written, restart Claude Code (or reload the VS Code window) for the MCP servers to register.

**Verify connectivity** before running migration (tool count: OB1 ≥ 1, job-search = 17):

```bash
source .env

# OB1 MCP — list tools
curl -s "$OB1_MCP_URL/mcp" \
  -H "x-brain-key: $OB1_MCP_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  | grep '^data:' | head -1 | python3 -m json.tool | grep '"name"' | wc -l

# job-search MCP — expect 17
curl -s "$JOB_SEARCH_MCP_URL/mcp" \
  -H "x-brain-key: $JOB_SEARCH_MCP_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  | grep '^data:' | head -1 | python3 -m json.tool | grep '"name"' | wc -l

# If 401: key mismatch — re-run bash scripts/k8s-apply-env.sh
```

### 12. Run migration

Migrate existing local applicant files to OB1. The migration script connects directly to `localhost:5432` — ensure the PostgreSQL port-forward is running first (see "Accessing Services Locally" → "PostgreSQL Port-Forward").

```bash
source .venv/bin/activate && source .env && source .env.services
python scripts/migrate-to-ob1.py --dry-run   # preview — check for parse errors first
python scripts/migrate-to-ob1.py             # full run
```

## Docker Compose Alternative

`integrations/ob1/docker-compose.yml` runs the same 4 services (postgres, minio, openbrain MCP, job-search-mcp) without a Kubernetes cluster. Use this for lighter local development or when Docker Desktop K8s is unavailable.

### Prerequisites

- `openbrain-mcp-server:latest` must be pre-built from `$OB1_REPO_PATH` (set in `.env.services`, same as K8s step 3):

  ```bash
  docker build -t openbrain-mcp-server:latest \
    "$OB1_REPO_PATH/integrations/kubernetes-deployment/"
  ```

### Env Overrides for Compose Mode

Some values differ from K8s defaults. In `.env` (Claude CLI config):

```bash
DATA_BACKEND=ob1
OB1_MCP_URL=http://localhost:8080     # direct port (not /ob1 Ingress path)
JOB_SEARCH_MCP_URL=http://localhost:8081
JOB_SEARCH_REST_URL=http://job-search-mcp:8001   # webapp REST client (compose service name)
```

In `.env.services` (storage credentials):

```bash
DB_HOST=postgres              # compose service name (not localhost or cluster DNS)
MINIO_ENDPOINT=minio:9000     # compose service name (not localhost:30900)
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
  psql -U postgres -d openbrain < integrations/ob1/job-search-schema.sql

# Full stack with webapp
docker compose -f webapp/docker-compose.yml up -d &
bash scripts/start-ob1.sh up -d
```

### Service Access (compose mode)

| Service | URL | Notes |
|---|---|---|
| OB1 MCP | `http://localhost:8080/mcp` | Used by Claude Code `.mcp.json` |
| job-search MCP | `http://localhost:8081/mcp` | Used by Claude Code `.mcp.json` |
| OB1 REST API | `http://localhost:8002` | PostgreSQL-backed REST API for the dashboard |
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
| OB1 MCP | `http://localhost/ob1/mcp` | Used by Claude Code `.mcp.json`; base path `/ob1` returns 401 |
| job-search MCP | `http://localhost/job-search/mcp` | Used by Claude Code `.mcp.json`; base path `/job-search` returns 401 |
| job-search REST API | `http://localhost/job-search/api/v2/*` | Used by the webapp; auth via `x-brain-key` header |
| MinIO console | `http://localhost/minio` | Web UI — bucket management |
| MinIO S3 API | `http://localhost:30900` | S3 SDK / `mc` access (NodePort — fixed) |
| OB1 Dashboard | `http://localhost:30303` | Next.js browser UI for OB1 thoughts (NodePort — fixed) |
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

## Verify Deployment

Run the full test suite (19 assertions: namespace, secrets, pods, Postgres, 9 js_* tables, MinIO bucket, ingress, both MCP servers, migration data, and functional tool round-trips):

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
| `.env` | Claude CLI config: paths, MCP access keys, `DATA_BACKEND` |
| `.env.services` | Storage credentials: MinIO, PostgreSQL, LLM API keys, `ANTHROPIC_API_DEPLOYMENT_KEY`, `OB1_REPO_PATH` |

**Why the split:** Claude's shell inherits exported vars. Keeping storage credentials out of `.env` means Claude cannot reach MinIO or Postgres directly — all applicant data must flow through OB1 MCP tools. See [memory/feedback_ob1_integration.md](../../memory/feedback_ob1_integration.md).

### Variables by file

**`.env`** (Claude CLI — sourced by Claude Code shell):

| Variable | Where used | Notes |
|----------|-----------|-------|
| `OB1_MCP_URL` | Claude Code `.mcp.json` | K8s: `http://localhost/ob1` (via Ingress) · Compose: `http://localhost:8080` |
| `OB1_MCP_KEY` | Claude Code `.mcp.json` | Auth header for OB1 MCP |
| `JOB_SEARCH_MCP_URL` | Claude Code `.mcp.json` | K8s: `http://localhost/job-search` (via Ingress) · Compose: `http://localhost:8081` |
| `JOB_SEARCH_MCP_KEY` | k8s `webapp-secret` → `MCP_ACCESS_KEY`; webapp | Auth header for job-search MCP and REST API |
| `JOB_SEARCH_REST_URL` | Webapp (`ObRestClient`) | K8s: set in `webapp-configmap.yml` · Compose: `http://job-search-mcp:8001` · Local dev: `http://localhost:8001` |
| `DATA_BACKEND` | Webapp, Claude Code | `ob1` when OB1 services are running |

**`.env.services`** (storage credentials — NOT sourced by Claude Code shell):

| Variable | Where used | Notes |
|----------|-----------|-------|
| `OB1_REPO_PATH` | `docker build` | Path to OB1 repo checkout for building `openbrain-mcp-server:latest` |
| `OBJECT_STORE_BACKEND` | job-search-tools.ts | `minio` or `supabase` |
| `MINIO_ENDPOINT` | job-search-tools.ts | `localhost:30900` locally (NodePort); `minio:9000` in compose |
| `MINIO_ACCESS_KEY` | job-search-tools.ts, k8s Secret | |
| `MINIO_SECRET_KEY` | job-search-tools.ts, k8s Secret | |
| `MINIO_BUCKET` | job-search-tools.ts | `job-search` |
| `MINIO_SECURE` | job-search-tools.ts | `false` for local K8s |
| `DB_HOST` | job-search-server.ts | `localhost` locally; `postgres` in compose; cluster DNS in k8s ConfigMap |
| `DB_PORT` | job-search-server.ts | `5432` |
| `DB_NAME` | job-search-server.ts | `openbrain` |
| `DB_USER` | job-search-server.ts | `postgres` |
| `DB_PASSWORD` | job-search-server.ts, k8s Secret | |
| `LLM_API_KEY` | k8s Secret → `EMBEDDING_API_KEY`, `CHAT_API_KEY`; also patches `openbrain-secret` | OpenRouter or OpenAI key |
| `EMBEDDING_API_BASE` | `job-search-llm-config` ConfigMap → job-search-mcp | Default: `https://openrouter.ai/api/v1`; OpenAI: `https://api.openai.com/v1` |
| `EMBEDDING_MODEL` | `job-search-llm-config` ConfigMap → job-search-mcp | Default: `openai/text-embedding-3-small`; OpenAI: `text-embedding-3-small` |
| `CHAT_API_BASE` | `job-search-llm-config` ConfigMap → job-search-mcp | Default: `https://openrouter.ai/api/v1`; OpenAI: `https://api.openai.com/v1` |
| `CHAT_MODEL` | `job-search-llm-config` ConfigMap → job-search-mcp | Default: `openai/gpt-4o-mini`; OpenAI: `gpt-4o-mini` |
| `ANTHROPIC_API_DEPLOYMENT_KEY` | k8s `webapp-secret` → `ANTHROPIC_API_KEY` | Container-only; not needed for local Claude Code (uses OAuth) |
| `DASHBOARD_SESSION_SECRET` | k8s `dashboard-secret` → `SESSION_SECRET` | iron-session cookie encryption key — min 32 chars; generate with `openssl rand -hex 32` |

Supabase alternative (if `OBJECT_STORE_BACKEND=supabase`): set `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET` in `.env.services` instead of the MinIO vars.

### K8s resources created by `k8s-apply-env.sh`

**k8s Secret** (`job-search-secret`) — 6 sensitive vars from `.env.services`. Never edit the Secret YAML directly.

**k8s ConfigMap** (`job-search-configmap.yml`) — non-sensitive subset with cluster-internal DNS names; overrides localhost values inside the cluster.

**`job-search-llm-config` ConfigMap** — 4 LLM API settings from `.env.services`. Defaults to OpenRouter; override for OpenAI. Re-running the script after any change takes effect on next pod restart.

**`openbrain-secret`** — 4 keys for the OB1 StatefulSet: `postgres-password` (`$DB_PASSWORD`), `mcp-access-key` (`$OB1_MCP_KEY`), `embedding-api-key` (`$LLM_API_KEY`), `chat-api-key` (`$LLM_API_KEY`). Do not apply the OB1 repo's `secrets.yml` — it contains hardcoded values.

**`dashboard-secret`** — 1 key for the OB1 Dashboard pod: `SESSION_SECRET` (`$DASHBOARD_SESSION_SECRET`). Required by the Next.js iron-session middleware for cookie encryption.

**`openbrain-configmap`** — non-sensitive OB1 config from `.env.services` + `.env`. The OB1 mcp-server container consumes these via `envFrom`, overriding any hardcoded values in `openbrain.yml`.
