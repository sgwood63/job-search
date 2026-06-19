# Langfuse Observability Integration

## Overview

Langfuse traces are emitted from all LLM call sites in the job-search system. Tracing is opt-in: it activates automatically when `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are present in the environment; missing keys produce a no-op with no errors.

Langfuse itself is **external** — you run it (cloud or self-hosted). This repo only contains the client SDK instrumentation.

---

## Component Coverage Map

| Component | Instrumentation | Traces emitted |
|---|---|---|
| FastAPI backend — WebSocket chat (`_run_message_thread`) | Python SDK | `claude-chat` generation per message |
| FastAPI backend — skill HTTP API (`POST /api/skills/{name}/run`) | Python SDK | `skill-run` generation per skill invocation |
| `job-search-mcp` (Deno) | JS SDK | `embedding`, `summarize-for-embedding`, `extract-metadata` generations |
| `ob1-rest-pg` (Deno) | JS SDK | `embedding` generation per semantic search |
| `openbrain-mcp` (external binary) | Proxy sidecar | `embedding` and `chat` generations via `langfuse-proxy` — see Proxy Architecture below |

---

## Trace Schema

```
Trace: {session.label}                       ← chat session
  session_id: {session.id}
  tags: ["data_backend:ob1", "mode:execute"]
  └── Generation: claude-chat
        model: "claude-opus-4-8"             ← from NDJSON system event
        input: first 500 chars of message
        output: first 500 chars of response
        usage: { input: N, output: M, unit: "TOKENS" }

Trace: skill/{name}                          ← HTTP skill execution
  tags: ["skill:resume-generation:v3", "adapter:claude-runner", "data_backend:ob1"]
  └── Generation: skill-run
        model: "claude-opus-4-8"             ← from transcript system event
        output: first 500 chars of output
        usage: { input: N, output: M, unit: "TOKENS" }

Trace: embedding                             ← job-search-mcp thought capture
  tags: ["service:job-search-mcp"]
  └── Generation: embedding
        model: "openai/text-embedding-3-small"
        input: first 200 chars of text
        usage: { input: prompt_tokens, output: 0 }

Trace: summarize-for-embedding               ← triggered when content > 25k chars
  tags: ["service:job-search-mcp"]
  └── Generation: summarize-for-embedding
        model: "openai/gpt-4o-mini"
        usage: { input: N, output: M }

Trace: extract-metadata                      ← job-search-mcp thought capture
  tags: ["service:job-search-mcp"]
  └── Generation: extract-metadata
        model: "openai/gpt-4o-mini"
        usage: { input: N, output: M }

Trace: embedding                             ← ob1-rest-pg semantic search
  tags: ["service:ob1-rest-pg"]
  └── Generation: embedding
        model: "openai/text-embedding-3-small"
        usage: { input: prompt_tokens, output: 0 }

Trace: embedding                             ← openbrain-mcp thought capture (via proxy)
  tags: ["service:openbrain-mcp"]
  └── Generation: embedding
        model: "openai/text-embedding-3-small"
        input: first 500 chars of embedded text
        usage: { input: prompt_tokens, output: 0 }

Trace: chat                                  ← openbrain-mcp metadata extraction (via proxy)
  tags: ["service:openbrain-mcp"]
  └── Generation: chat
        model: "openai/gpt-4o-mini"
        input: last message (first 500 chars)
        output: first 500 chars of completion
        usage: { input: prompt_tokens, output: completion_tokens }
```

---

## Configuration

### 1. Get Langfuse keys

Sign up at [cloud.langfuse.com](https://cloud.langfuse.com) (free tier: ~50k observations/month) or run the self-hosted Docker image.

In your Langfuse project: **Settings → API Keys** → copy the public key and secret key.

### 2. Add keys to `.env.services`

```bash
export LANGFUSE_HOST="https://cloud.langfuse.com"   # or your self-hosted URL
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
```

Restart the webapp and MCP server — tracing activates immediately.

### 3. Apply to K8s (if using cluster deployment)

```bash
# Build the proxy image (must be available in your cluster's image registry or local Docker)
docker build -t langfuse-proxy:latest \
  -f integrations/ob1/langfuse-proxy/Dockerfile integrations/ob1/

bash scripts/k8s-apply-env.sh
kubectl rollout restart statefulset/openbrain -n openbrain
kubectl rollout restart deployment/job-search-mcp -n openbrain
kubectl rollout restart deployment/webapp -n openbrain
```

---

## Using the Langfuse Dashboard

### Token efficiency

Filter traces by tag `data_backend:ob1` → group by generation name → compare `input_tokens` + `output_tokens` across dates. Spikes after a skill version change indicate prompt regression.

### Prompt version comparison

Filter by tag `skill:resume-generation:v3` vs `skill:resume-generation:v2` → compare output quality scores and token counts.

### Cost per workflow

Langfuse can map model names to per-token pricing. Set up **Models** in your Langfuse project settings to get cost estimates per trace.

---

## Proxy Architecture

`openbrain-mcp` (the external binary) cannot be directly instrumented. Instead, a thin Deno proxy sidecar intercepts its LLM calls:

```
openbrain-mcp
  EMBEDDING_API_BASE=http://localhost:8080  ─┐
  CHAT_API_BASE=http://localhost:8080       ─┤→  langfuse-proxy (:8080)
                                              │     ├─ logs to Langfuse
                                              │     └─ forwards to upstream
                                              └──→  OpenRouter / OpenAI
```

In **K8s**: proxy runs as a 3rd container in the `openbrain` StatefulSet pod; sidecar networking means `localhost:8080` is the proxy.

In **Docker Compose**: proxy runs as the `langfuse-proxy` service; openbrain reaches it via Docker DNS as `http://langfuse-proxy:8080`.

`k8s-apply-env.sh` wires the env vars automatically — `EMBEDDING_API_BASE` and `CHAT_API_BASE` in `openbrain-configmap` are hardcoded to `http://localhost:8080`, while `UPSTREAM_EMBEDDING_API_BASE` and `UPSTREAM_CHAT_API_BASE` hold the real API URLs.

---

## Claude Code Session Tracing

Claude Code session turns are captured via a Stop hook (`scripts/langfuse_cc_hook.py`) that runs after every assistant response. It uses stdlib only — no pip installs required in the hook environment.

### What it captures

Each turn produces a `cc-turn` generation span nested under a `claude-code-session` trace:

```
Trace: claude-code-session
  id: {session_id}               ← stable across the whole session
  tags: ["service:claude-code", "project:job-search", ...]
  └── Generation: cc-turn
        model: {model}
        input: {user message, first 500 chars}
        output: {assistant response, first 500 chars}
        usage: { input: N, output: M, unit: "TOKENS" }
```

If the turn invoked a `/skill`, a `skill:<name>` tag is added automatically.

### Credential resolution

The hook reads `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` from the environment first, then falls back to `.env.services` in the repo root. No manual export needed as long as `.env.services` is populated.

### Turn-level phase auto-detection

Each turn is automatically classified by inspecting the tool_use blocks in the response cycle — no manual env var required:

| Trigger | Phase tag |
|---|---|
| Skill: `ingest`, `linkedin-ingest`, `status`, `apply`, `audit`, `interview`, `context`, `memory` | `phase:operations` |
| Any `mcp__job-search__*` or `mcp__open-brain__*` MCP tool called | `phase:operations` |
| Skill: `code-review`, `simplify`, `verify`, `run`, `security-review`, `init` | `phase:development` |
| Bash with `kubectl`, `docker build`, `docker compose`, or `helm` | `phase:development` |
| Plain text response, no significant tool use | *(no phase tag)* |

Operations signals take priority: if a turn deploys to k8s *and* checks application status, it's tagged `phase:operations`.

In the Langfuse dashboard, filter **Traces** by tag `phase:operations` to see only job-search operational activity, or `phase:development` for infrastructure/code work.

### Extra tags via `CC_LANGFUSE_TAGS`

Use `CC_LANGFUSE_TAGS` to add context beyond auto-detected phase — for example, to track which profile an ingest session targeted:

```bash
export CC_LANGFUSE_TAGS="profile:presales-se"
claude
```

Multiple tags are comma-separated. These are appended *alongside* auto-detected phase tags, not instead of them.

### Debug logging

```bash
export CC_LANGFUSE_DEBUG=1
# ... run a Claude Code session ...
cat ~/.claude/state/langfuse_cc_hook.log
```

---

## Key Files

| File | Role |
|---|---|
| [scripts/langfuse_cc_hook.py](../../scripts/langfuse_cc_hook.py) | Claude Code Stop hook — session turn tracing (stdlib-only Python) |
| [webapp/backend/runtime/langfuse_client.py](../../webapp/backend/runtime/langfuse_client.py) | Python singleton — import `from runtime import langfuse_client as lf` |
| [integrations/ob1/langfuse_ts.ts](../../integrations/ob1/langfuse_ts.ts) | Deno singleton — shared by job-search-mcp, ob1-rest-pg, and langfuse-proxy |
| [integrations/ob1/langfuse-proxy/proxy.ts](../../integrations/ob1/langfuse-proxy/proxy.ts) | Transparent proxy sidecar for openbrain-mcp |
| [integrations/ob1/langfuse-proxy/Dockerfile](../../integrations/ob1/langfuse-proxy/Dockerfile) | Proxy image build |
| [webapp/backend/main.py](../../webapp/backend/main.py) | Chat + skill path instrumentation |
| [integrations/ob1/job-search-server.ts](../../integrations/ob1/job-search-server.ts) | Embedding + chat completion instrumentation |
| [integrations/ob1/ob1-rest-pg/index.ts](../../integrations/ob1/ob1-rest-pg/index.ts) | ob1-rest-pg embedding instrumentation |

---

## Extending: Adding a New Generation Span

### Python

```python
from runtime import langfuse_client as lf

with lf.span(
    "my-generation",                      # generation name in Langfuse
    trace_name="my-workflow",             # trace name (groups related spans)
    tags=["skill:my-skill:v1"],
    input_text=prompt[:500],
) as gen:
    result = call_llm(prompt)
    gen.set_model("claude-opus-4-8")
    gen.set_usage(input=100, output=50)
    gen.set_output(result[:500])
```

### TypeScript (Deno)

```typescript
import { traceGeneration } from "./langfuse_ts.ts";

const result = await callLLM(prompt);
traceGeneration({
    name: "my-generation",
    model: MY_MODEL,
    input: prompt.slice(0, 200),
    output: result.slice(0, 200),
    usage: { input: result.usage.prompt_tokens, output: result.usage.completion_tokens },
    tags: ["service:my-service"],
}).catch(() => {});   // fire-and-forget; never throws into the main path
```

---

## Future: Temporal Activity Integration (Phase 3)

When Temporal workers are built (Phase 3 roadmap), activities can use the same `langfuse_client` without modification:

```python
from runtime import langfuse_client as lf

@activity.defn
async def generate_resume(input: ResumeInput) -> ResumeResult:
    with lf.span(
        "resume-generation",
        trace_name=f"workflow/{input.workflow_id}",
        tags=[f"skill:resume-generation:v3"],
    ) as gen:
        result = await run_skill(...)
        gen.set_usage(input=result.usage.get("input_tokens", 0),
                      output=result.usage.get("output_tokens", 0))
    return result
```

The `runtime/langfuse_client.py` module has no FastAPI dependency — it's clean for worker use.
