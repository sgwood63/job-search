FROM denoland/deno:2.3.3
# All configuration is injected at runtime — no ENV instructions in this file.
# Local:  docker run --env-file /path/to/.env -p 8080:8080 langfuse-proxy:latest
# K8s:    runs as sidecar in openbrain StatefulSet pod; env from openbrain-configmap + openbrain-secret
#
# Build context must be integrations/ob1/ (parent directory) to access langfuse_ts.ts:
#   docker build -t langfuse-proxy:latest \
#     -f integrations/ob1/langfuse-proxy/Dockerfile integrations/ob1/

WORKDIR /app

# langfuse_ts.ts is in the parent (integrations/ob1/) build context
COPY langfuse_ts.ts ./
COPY langfuse-proxy/deno.json ./
COPY langfuse-proxy/proxy.ts ./

# Cache static dependencies; the dynamic import("langfuse") will be fetched
# on first run and stored in the Deno module cache directory.
RUN deno cache proxy.ts

# Run as non-root
USER deno

EXPOSE 8080

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-sys", "proxy.ts"]
