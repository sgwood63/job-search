/**
 * Transparent OpenAI-compatible proxy with Langfuse observability.
 *
 * Sits as a sidecar alongside openbrain-mcp. openbrain-mcp points its
 * EMBEDDING_API_BASE and CHAT_API_BASE at this proxy (http://localhost:8080),
 * which forwards requests to the real upstream and logs telemetry to Langfuse.
 *
 * Routes:
 *   POST /v1/embeddings         → UPSTREAM_EMBEDDING_API_BASE/embeddings
 *   POST /v1/chat/completions   → UPSTREAM_CHAT_API_BASE/chat/completions
 *   GET  /health                → 200 OK
 *
 * Auth pass-through: the Authorization header from the caller is forwarded
 * unchanged. The proxy never reads or stores the API key value.
 *
 * Langfuse errors are caught and discarded — they never block a response.
 */

import { traceGeneration, flushLangfuse } from "./langfuse_ts.ts";

const EMBEDDING_UPSTREAM =
  Deno.env.get("UPSTREAM_EMBEDDING_API_BASE") || "https://openrouter.ai/api/v1";
const CHAT_UPSTREAM =
  Deno.env.get("UPSTREAM_CHAT_API_BASE") || "https://openrouter.ai/api/v1";
const PORT = parseInt(Deno.env.get("PORT") || "8080");

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/health") {
    return new Response("ok");
  }

  const isEmbedding = url.pathname === "/v1/embeddings";
  const isChat = url.pathname === "/v1/chat/completions";

  if (!isEmbedding && !isChat) {
    return new Response("Not Found", { status: 404 });
  }

  const upstreamBase = isEmbedding ? EMBEDDING_UPSTREAM : CHAT_UPSTREAM;
  const upstreamPath = isEmbedding ? "/embeddings" : "/chat/completions";
  const upstreamUrl = `${upstreamBase}${upstreamPath}`;

  const bodyText = await req.text();
  // deno-lint-ignore no-explicit-any
  let body: Record<string, any> = {};
  try {
    body = JSON.parse(bodyText);
  } catch { /* non-JSON body, forward as-is */ }

  // Strip hop-by-hop headers before forwarding
  const forwardHeaders = new Headers();
  for (const [k, v] of req.headers) {
    if (k.toLowerCase() === "host") continue;
    forwardHeaders.set(k, v);
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: forwardHeaders,
      body: bodyText,
    });
  } catch (e) {
    console.error("[langfuse-proxy] upstream fetch failed:", e);
    return new Response("Bad Gateway", { status: 502 });
  }

  const respText = await upstreamRes.text();
  // deno-lint-ignore no-explicit-any
  let respBody: Record<string, any> = {};
  try {
    respBody = JSON.parse(respText);
  } catch { /* non-JSON response */ }

  // --- Telemetry extraction ---
  const model = (body.model as string) || "unknown";

  let inputText = "";
  if (isEmbedding) {
    inputText = typeof body.input === "string"
      ? body.input
      : JSON.stringify(body.input ?? "");
  } else {
    const msgs = body.messages as Array<Record<string, unknown>> | undefined;
    inputText = msgs ? JSON.stringify(msgs.at(-1)) : "";
  }

  let outputText = "";
  if (isChat) {
    const choices = respBody.choices as Array<{ message?: { content?: string } }> | undefined;
    outputText = choices?.[0]?.message?.content ?? "";
  }

  let usage: { input: number; output: number } | undefined;
  if (respBody.usage) {
    const u = respBody.usage as Record<string, number>;
    usage = { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0 };
  }

  traceGeneration({
    name: isEmbedding ? "embedding" : "chat",
    model,
    input: String(inputText).slice(0, 500),
    output: String(outputText).slice(0, 500),
    usage,
    tags: ["service:openbrain-mcp"],
  }).catch(() => {});

  // Return upstream response, stripping hop-by-hop headers
  const respHeaders = new Headers();
  for (const [k, v] of upstreamRes.headers) {
    const lk = k.toLowerCase();
    if (lk === "transfer-encoding" || lk === "connection") continue;
    respHeaders.set(k, v);
  }

  return new Response(respText, {
    status: upstreamRes.status,
    headers: respHeaders,
  });
}

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, handler);

console.log(`[langfuse-proxy] listening on :${PORT}`);
console.log(`[langfuse-proxy] embedding → ${EMBEDDING_UPSTREAM}`);
console.log(`[langfuse-proxy] chat      → ${CHAT_UPSTREAM}`);

async function shutdown() {
  await flushLangfuse();
  Deno.exit(0);
}

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);
