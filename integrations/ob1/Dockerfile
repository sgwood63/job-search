FROM denoland/deno:2.3.3
# All configuration is injected at runtime — no ENV instructions in this file.
# Local:  docker run --env-file /path/to/.env -p 8001:8001 job-search-mcp:latest
# K8s:    envFrom job-search-configmap + job-search-secret (see k8s/ and scripts/k8s-apply-env.sh)

WORKDIR /app

COPY deno.json ./
COPY job-search-tools.ts ./
COPY job-search-server.ts ./

# Cache all dependencies as root so /deno-dir is pre-populated before USER switch
RUN deno cache job-search-server.ts

# Run as non-root
USER deno

EXPOSE 8001

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-sys", "job-search-server.ts"]
