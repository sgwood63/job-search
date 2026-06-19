FROM denoland/deno:2.3.3
# All configuration is injected at runtime — no ENV instructions in this file.
# Local:  docker run --env-file /path/to/.env -p 8002:8002 ob1-rest-pg:latest
# K8s:    envFrom ob1-rest-pg-configmap + ob1-rest-pg-secret (see k8s/ and scripts/k8s-apply-env.sh)
#
# Build context must be integrations/ob1/ (parent directory) to access langfuse_ts.ts:
#   docker build -t ob1-rest-pg:latest \
#     -f integrations/ob1/ob1-rest-pg/Dockerfile integrations/ob1/

WORKDIR /app

# Mirror source layout so ../langfuse_ts.ts resolves correctly from ob1-rest-pg/index.ts
COPY langfuse_ts.ts ./
COPY ob1-rest-pg/deno.json ./ob1-rest-pg/
COPY ob1-rest-pg/index.ts ./ob1-rest-pg/

# cd into the subdir so Deno 2.x picks up ob1-rest-pg/deno.json for import-map resolution
# chown ensures the deno user can manage node_modules created by nodeModulesDir=auto
RUN cd ob1-rest-pg && deno cache index.ts && chown -R deno:deno /app

# Run as non-root
USER deno

EXPOSE 8002

# Run from the subdir so Deno finds deno.json and ../langfuse_ts.ts resolves to /app/langfuse_ts.ts
WORKDIR /app/ob1-rest-pg
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-sys", "index.ts"]
