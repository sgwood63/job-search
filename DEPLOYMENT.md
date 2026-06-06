# Deployment Guide

This guide covers all supported ways to run the job search system. The system has five independently-variable deployment dimensions — understanding them lets the user pick the right combination rather than guessing from a flat list of "configurations."

For day-to-day usage after setup, see [USER-GUIDE.md](USER-GUIDE.md). For system internals and DEV_MODE, see [DEVELOPER-README.md](DEVELOPER-README.md).

---

## Deployment Dimensions

### 1. Applicant Data Backend

Where applicant data is stored. Controlled by `DATA_BACKEND` in `.env`.

| Value | What it means |
|-------|---------------|
| `local` (default) | Files read/written directly from `$APPLICANT_DIR` on disk (or a cloud-synced folder) |
| `ob1` | All data goes through OB1 MCP tools — files in MinIO or Supabase, structured state in PostgreSQL |

### 2. OB1 Infrastructure *(only if `DATA_BACKEND=ob1`)*

How OB1 services are deployed.

| Option | Description |
|--------|-------------|
| **Docker Compose** | Self-managed — all 4 OB1 services in one compose stack, no K8s cluster required |
| **Kubernetes** | Self-managed — K8s cluster (Docker Desktop or cloud) with nginx Ingress |
| **OB1 Default Deployment** | Follow the [OB1 getting-started guide](https://github.com/NateBJones-Projects/OB1/blob/main/docs/01-getting-started.md), then add the job-search extension |

### 3. OB1 Data Store *(only for self-managed OB1)*

Where OB1 stores files and structured data.

| Option | Description |
|--------|-------------|
| **Postgres + MinIO** | Default for self-managed deployments (compose or K8s) |
| **Supabase** | Used with the OB1 Default Deployment path — *experimental / in progress* |

### 4. App Driver *(orthogonal to data backend)*

How the user interacts with the system.

| Option | Description |
|--------|-------------|
| **Claude Code** | Terminal (`claude`) or VS Code extension — no webapp required |
| **Web App** | FastAPI + React browser UI — optional companion to Claude Code |

### 5. Webapp Deployment *(only if using the web app)*

Where the web app process runs.

| Option | Description |
|--------|-------------|
| **Local (via `start.sh`)** | Runs directly on the user's machine via `bash webapp/start.sh` |
| **Docker Compose** | Containerized; combinable with the OB1 compose stack |
| **Kubernetes (same namespace as OB1)** | Runs in the `openbrain` namespace alongside OB1 services |

---

## Decision Guide

Answer these questions in order:

**1. Where should applicant data live?**
- Local disk or cloud-synced folder, no extra services → `DATA_BACKEND=local` — see [Config 1](#config-1-local-data--claude-code) or [Config 2](#config-2-local-data--webapp)
- Persistent database + object store + semantic search → `DATA_BACKEND=ob1` — continue below

**2. If OB1: how should the OB1 stack run?**
- No K8s cluster available → [Config 3: Docker Compose](#config-3-ob1-docker-compose--webapp-docker-compose)
- K8s cluster available (Docker Desktop or cloud) → [Config 4: Kubernetes](#config-4-ob1-kubernetes--webapp-same-namespace)
- Following OB1's own getting-started guide → [Config 5: OB1 Default Deployment](#config-5-ob1-default-deployment-experimental)

**3. Web app or Claude Code terminal?**
- Terminal only → no additional setup beyond data backend
- Browser UI → add the webapp deployment step for your chosen infrastructure

---

## Authentication

> **OAuth works for local Claude Code terminal sessions only.** All container deployments (Docker Compose, K8s) require `ANTHROPIC_API_DEPLOYMENT_KEY` set in `.env` — OAuth is not available inside containers.

Set `ANTHROPIC_API_DEPLOYMENT_KEY` in `.env` to an API key from [console.anthropic.com](https://console.anthropic.com) before running any Docker or K8s deployment.

---

## `.env` Configuration

`scripts/setup.sh` generates `.env` for the **local CLI baseline only** — it does not populate OB1 or container variables. For all other deployment modes, copy `.env.example` from the repo root and fill in the relevant sections:

```bash
cp .env.example .env
# Edit .env — fill in values for your chosen deployment mode
source .env
```

The annotated `.env.example` is grouped by section: base setup, webapp, OB1 integration (backend selector, MinIO, PostgreSQL, MCP URLs, LLM), and Supabase (cloud alternative).

### Compose vs K8s env var differences

The single most common configuration mistake is mixing compose service names with K8s cluster DNS (or vice versa). The values are different:

| Variable | Docker Compose | Kubernetes |
|----------|----------------|------------|
| `DB_HOST` | `postgres` | `openbrain-db.openbrain.svc.cluster.local` |
| `MINIO_ENDPOINT` | `minio:9000` | `minio.openbrain.svc.cluster.local:9000` |
| `OB1_MCP_URL` | `http://localhost:8080` | `http://localhost/ob1` |
| `JOB_SEARCH_MCP_URL` | `http://localhost:8081` | `http://localhost/job-search` |

The compose values use Docker service names (resolved inside the compose network). The K8s values use cluster-internal DNS (resolved inside pods) for the MCP servers and the nginx Ingress path for external access.

After changing any `.env` value, regenerate `.mcp.json` so Claude Code uses the updated MCP server addresses:

```bash
bash scripts/k8s-apply-env.sh
```

---

## Tested Configurations

### Config 1: Local data + Claude Code

The default path. All applicant files live on disk in `$APPLICANT_DIR`. Claude Code reads and writes files directly. No containers required.

**Prerequisites:** Claude Code installed, `.env` generated by `bash scripts/setup.sh`

See [QUICK-START.md](QUICK-START.md) for the full setup walkthrough.

---

### Config 2: Local data + Webapp

The web app runs alongside Claude Code, reading from `$APPLICANT_DIR` on disk. No database or object store required.

**Prerequisites:** Python 3.8+, Node.js + npm, `.env` with `DATA_BACKEND=local`

**Option A — Direct launch (recommended):**
```bash
bash webapp/start.sh
```
Open [http://localhost:8000](http://localhost:8000). Requires Claude Code 2.1.152+ (`start.sh` checks and fails fast if the binary is too old).

**Option B — Vite dev server (hot-module reload):**
```bash
# Terminal 1 — backend
cd webapp/backend && uvicorn main:app --reload

# Terminal 2 — frontend
cd webapp/frontend && npm run dev
```
Open [http://localhost:5173](http://localhost:5173).

**Option C — Docker Compose (containerized local mode):**

Requires `ANTHROPIC_API_DEPLOYMENT_KEY` in `.env` (no OAuth in containers).

```bash
docker compose -f webapp/docker-compose.yml up
```
Open [http://localhost:8000](http://localhost:8000).

See [webapp/README.md](webapp/README.md) for install instructions and feature details.

---

### Config 3: OB1 Docker Compose + Webapp Docker Compose

All 4 OB1 services (PostgreSQL, MinIO, openbrain MCP, job-search-mcp) plus the webapp run as a single compose stack. No K8s cluster required.

**Prerequisites:**
- Docker and Docker Compose
- Local clone of the OB1 repo (`$OB1_REPO_PATH` in `.env`)
- `ANTHROPIC_API_DEPLOYMENT_KEY` in `.env`

**Step 1 — Configure `.env` for compose mode**

The compose stack uses Docker service names, not localhost or cluster DNS. Set these values in `.env`:

```
DATA_BACKEND=ob1
DB_HOST=postgres
MINIO_ENDPOINT=minio:9000
OB1_MCP_URL=http://localhost:8080
JOB_SEARCH_MCP_URL=http://localhost:8081
```

Fill in credentials for `DB_PASSWORD`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `OB1_MCP_KEY`, `JOB_SEARCH_MCP_KEY`, `LLM_API_KEY` from `.env.example`.

**Step 2 — Build the openbrain MCP image**

Required once (or after OB1 repo updates):

```bash
docker build -t openbrain-mcp-server:latest \
  "$OB1_REPO_PATH/integrations/kubernetes-deployment/"
```

**Step 3 — Regenerate `.mcp.json`**

So Claude Code terminal sessions reach MCP at the compose ports:

```bash
bash scripts/k8s-apply-env.sh
```

**Step 4 — Start the stack**

```bash
docker compose \
  -f webapp/docker-compose.yml \
  -f integrations/ob1/docker-compose.yml up
```

**Step 5 — Apply schema (first run only)**

```bash
docker compose -f integrations/ob1/docker-compose.yml exec postgres \
  psql -U postgres -d openbrain \
  < integrations/ob1/job-search-schema.sql
```

**Services (compose mode):**

| Service | URL / address |
|---------|---------------|
| Webapp | [http://localhost:8000](http://localhost:8000) |
| OB1 MCP | `http://localhost:8080/mcp` |
| job-search MCP | `http://localhost:8081/mcp` |
| MinIO S3 API | `http://localhost:9000` |
| MinIO console | [http://localhost:9001](http://localhost:9001) |
| PostgreSQL | `localhost:5432` |

**Verify:**
```bash
curl http://localhost:8000/api/health
# Expected: {"backend":"ob1","db":"ok","store":"ok"}
```

---

### Config 4: OB1 Kubernetes + Webapp (same namespace)

Full K8s stack in the `openbrain` namespace: OB1 StatefulSet, MinIO, job-search-mcp, nginx Ingress, and the webapp. All services are permanently accessible via nginx Ingress at port 80 once deployed — no per-session port-forwarding needed.

**Prerequisites:** kubectl, helm, Docker (Docker Desktop provides a local K8s cluster), local OB1 repo clone at `$OB1_REPO_PATH`

**Step 1 — Configure `.env` for K8s mode**

K8s services use cluster-internal DNS. Set these values in `.env`:

```
DATA_BACKEND=ob1
DB_HOST=openbrain-db.openbrain.svc.cluster.local
MINIO_ENDPOINT=minio.openbrain.svc.cluster.local:9000
OB1_MCP_URL=http://localhost/ob1
JOB_SEARCH_MCP_URL=http://localhost/job-search
```

Fill in all credential vars from `.env.example`.

**Step 2 — Push secrets and config to K8s**

```bash
bash scripts/k8s-apply-env.sh
```

Creates `openbrain-secret`, `openbrain-configmap`, `minio-secret`, `job-search-secret`, and `job-search-llm-config` in the `openbrain` namespace.

**Step 3 — Deploy OB1 services**

Follow [integrations/ob1/README.md](integrations/ob1/README.md) steps 2–9:
1. Install nginx Ingress Controller (helm)
2. Deploy OB1 (build `openbrain-mcp-server:latest`, apply `k8s/openbrain.yml`)
3. Apply nginx Ingress (`k8s/ingress.yml`)
4. Expose PostgreSQL (`k8s/openbrain-db-service.yml`)
5. Apply job-search schema (requires PostgreSQL port-forward — see below)
6. Deploy MinIO (`k8s/minio-configmap.yml`, `k8s/minio.yml`, `k8s/minio-s3-nodeport.yml`)
7. Deploy job-search-mcp (`k8s/job-search-configmap.yml`, build image, apply `k8s/job-search.yml`)
8. Create MinIO bucket

**Step 4 — Deploy the webapp**

Build images and apply manifests:

```bash
docker build -f webapp/Dockerfile -t job-search-webapp:latest .
docker build -f webapp/runner/Dockerfile webapp/runner/ -t job-search-claude-runner:latest
kubectl apply -f integrations/ob1/k8s/webapp-configmap.yml
kubectl apply -f integrations/ob1/k8s/webapp.yml
kubectl apply -f integrations/ob1/k8s/webapp-nodeport.yml
```

Verify (expect `2/2` — webapp + claude-runner sidecar):
```bash
kubectl get pods -n openbrain -l app=job-search-webapp
```

**Access:**

| Service | URL |
|---------|-----|
| Webapp | [http://localhost:30800](http://localhost:30800) |
| OB1 MCP | `http://localhost/ob1/mcp` |
| job-search MCP | `http://localhost/job-search/mcp` |
| MinIO S3 API | `localhost:30900` (NodePort — no port-forward needed) |
| MinIO console | [http://localhost/minio](http://localhost/minio) |

**Port-forwards (on demand, for admin tasks only):**

```bash
kubectl port-forward -n openbrain svc/openbrain-db 5432:5432 &  # PostgreSQL admin / schema apply
kubectl port-forward -n openbrain svc/minio 30900:9000 &         # MinIO S3 API (alternative to NodePort)
```

> Note: `svc/openbrain-db` is the PostgreSQL service (port 5432). `svc/openbrain` is the OB1 MCP service (port 8000) — do not confuse them.

**Step 5 — Verify**

```bash
bash integrations/ob1/tests/test-deployment.sh
# Runs 19 assertions against all services
```

```bash
curl http://localhost:30800/api/health
# Expected: {"backend":"ob1","db":"ok","store":"ok"}
```

For cloud K8s clusters (EKS, GKE, AKS): images must be pushed to a registry accessible to the cluster. The Ingress assumes port 80; LoadBalancer or NodePort configuration differs by cloud provider. See [integrations/ob1/README.md](integrations/ob1/README.md) for cloud-specific notes.

---

### Config 5: OB1 Default Deployment *(experimental)*

Runs OB1 using the OB1 project's own deployment guide, then adds the job-search extension as a companion service. Data store is Supabase (cloud) rather than self-managed MinIO.

> **Status: experimental / in progress.** The Supabase integration exists in the codebase but is not yet fully validated end-to-end.

**Step 1 — Deploy OB1**

Follow the [OB1 getting-started guide](https://github.com/NateBJones-Projects/OB1/blob/main/docs/01-getting-started.md).

**Step 2 — Add the job-search extension**

Once OB1 is running, deploy the job-search-mcp service alongside it. Configure `.env` with:

```
DATA_BACKEND=ob1
OBJECT_STORE_BACKEND=supabase
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_KEY=your_supabase_service_key
SUPABASE_BUCKET=job-search
```

Set PostgreSQL connection vars (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`) to point at OB1's database instance.

Run `bash scripts/k8s-apply-env.sh` to generate `.mcp.json`.

Apply the job-search schema to OB1's PostgreSQL:
```bash
psql -h $DB_HOST -U $DB_USER -d $DB_NAME < integrations/ob1/job-search-schema.sql
```

---

## Not Yet Documented

These combinations are not currently documented or validated:

- Webapp in a separate K8s namespace from OB1
- Webapp on a separate K8s cluster from OB1
