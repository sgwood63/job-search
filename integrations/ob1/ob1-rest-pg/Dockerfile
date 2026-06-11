FROM denoland/deno:2.3.3
# All configuration is injected at runtime — no ENV instructions in this file.
# Local:  docker run --env-file /path/to/.env -p 8002:8002 ob1-rest-pg:latest
# K8s:    envFrom ob1-rest-pg-configmap + ob1-rest-pg-secret (see k8s/ and scripts/k8s-apply-env.sh)

WORKDIR /app

COPY deno.json ./
COPY index.ts ./

# Cache all dependencies as root so /deno-dir is pre-populated before USER switch
RUN deno cache index.ts

# Run as non-root
USER deno

EXPOSE 8002

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-sys", "index.ts"]
