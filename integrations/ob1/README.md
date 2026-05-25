# OB1 Job Search Extension

Custom OB1 extension for managing all job search applicant content in Kubernetes.

## What This Is

This directory contains the files needed to integrate the job search system with a local Kubernetes deployment of OB1 (Open Brain). After setup:

- All applicant files (notes, JDs, PDFs) live in **MinIO** (object store)
- All structured state (pipeline, contacts, interviews) lives in **PostgreSQL** (OB1's database)
- Semantic search across all content via **pgvector** (OB1's thoughts table)
- No files remain on the local filesystem

## Directory Layout

```
integrations/ob1/
├── README.md                   (this file)
├── job-search-schema.sql       (9 SQL tables — run once against OB1 Postgres)
├── job-search-tools.ts         (MCP tool implementations — merge into OB1 index.ts)
└── k8s/
    └── minio.yml               (MinIO Kubernetes Deployment + Service + Secret)
```

## Setup Order

1. Follow the OB1 Kubernetes deployment guide: `OB1/integrations/kubernetes-deployment/README.md`
2. Apply MinIO: `kubectl apply -f integrations/ob1/k8s/minio.yml`
3. Create bucket: see Phase 1c in the plan
4. Run SQL schema: `kubectl exec -n openbrain openbrain-0 -c postgres -- psql -U postgres -d openbrain < integrations/ob1/job-search-schema.sql`
5. Merge `job-search-tools.ts` into `OB1/integrations/kubernetes-deployment/index.ts`
6. Rebuild and redeploy the OB1 MCP server image
7. Run migration: `python scripts/migrate-to-ob1.py`

## Environment Variables

Add to `.env`:

```bash
# Object store backend: 'minio' (local K8s) or 'supabase' (cloud)
OBJECT_STORE_BACKEND=minio

# MinIO (local K8s)
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=CHANGEME_MINIO_ACCESS_KEY
MINIO_SECRET_KEY=CHANGEME_MINIO_SECRET_KEY
MINIO_BUCKET=job-search
MINIO_SECURE=false

# Supabase (cloud — alternative backend)
# SUPABASE_URL=https://project.supabase.co
# SUPABASE_SERVICE_KEY=your-service-key
# SUPABASE_BUCKET=job-search

# OB1 Postgres (local K8s — via port-forward localhost:5432)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=openbrain
DB_USER=postgres
DB_PASSWORD=CHANGEME_POSTGRES_PASSWORD

# OB1 MCP server (local K8s — via port-forward localhost:8000)
OB1_MCP_URL=http://localhost:8000
OB1_MCP_KEY=CHANGEME_MCP_ACCESS_KEY
```
