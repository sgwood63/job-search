/**
 * Langfuse observability singleton for Deno services.
 *
 * Enabled automatically when LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY are both set.
 * All exported functions are no-ops when keys are absent — zero overhead.
 *
 * Shared by job-search-server.ts and ob1-rest-pg/index.ts.
 * Import with: import { traceGeneration, LANGFUSE_ENABLED } from "./langfuse_ts.ts"
 * (ob1-rest-pg) uses: import { traceGeneration } from "../langfuse_ts.ts"
 */

const _host = Deno.env.get("LANGFUSE_HOST") || "https://cloud.langfuse.com";
const _publicKey = Deno.env.get("LANGFUSE_PUBLIC_KEY") || "";
const _secretKey = Deno.env.get("LANGFUSE_SECRET_KEY") || "";

export const LANGFUSE_ENABLED = Boolean(_publicKey && _secretKey);

// Lazy-initialized singleton — deferred so startup is unaffected when disabled.
// deno-lint-ignore no-explicit-any
let _lf: any = null;
let _lfInited = false;

// deno-lint-ignore no-explicit-any
async function getClient(): Promise<any | null> {
  if (!LANGFUSE_ENABLED) return null;
  if (!_lfInited) {
    _lfInited = true;
    try {
      const { Langfuse } = await import("langfuse");
      _lf = new Langfuse({
        publicKey: _publicKey,
        secretKey: _secretKey,
        baseUrl: _host,
      });
    } catch (e) {
      console.error("[langfuse] init failed:", e);
    }
  }
  return _lf;
}

export interface TraceGenerationOpts {
  name: string;
  model: string;
  input?: string;
  output?: string;
  usage?: { input: number; output: number };
  tags?: string[];
  traceId?: string;
  sessionId?: string;
}

/**
 * Emit a Langfuse generation event. Awaitable; safe to fire-and-forget with
 * .catch(). If Langfuse is not configured or the SDK throws, the error is
 * logged to stderr and the function returns silently.
 */
export async function traceGeneration(opts: TraceGenerationOpts): Promise<void> {
  const client = await getClient();
  if (!client) return;
  try {
    const traceOpts: Record<string, unknown> = { name: opts.traceId || opts.name };
    if (opts.tags?.length) traceOpts.tags = opts.tags;
    if (opts.sessionId) traceOpts.sessionId = opts.sessionId;
    const trace = client.trace(traceOpts);

    const genOpts: Record<string, unknown> = {
      name: opts.name,
      model: opts.model,
    };
    if (opts.input) genOpts.input = opts.input.slice(0, 500);
    if (opts.output) genOpts.output = opts.output.slice(0, 500);
    if (opts.usage) {
      genOpts.usage = {
        input: opts.usage.input,
        output: opts.usage.output,
        unit: "TOKENS",
      };
    }

    const gen = trace.generation(genOpts);
    gen.end();
  } catch (e) {
    console.error("[langfuse] traceGeneration failed:", e);
  }
}

export interface TraceSpanOpts {
  name: string;
  tags?: string[];
  traceId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  durationMs?: number;
  level?: "DEFAULT" | "WARNING" | "ERROR";
  statusMessage?: string;
}

/**
 * Emit a Langfuse span event for a non-LLM operation (tool call, DB query, HTTP request, etc.).
 * Safe to fire-and-forget with .catch(). No-op when Langfuse is not configured.
 */
export async function traceSpan(opts: TraceSpanOpts): Promise<void> {
  const client = await getClient();
  if (!client) return;
  try {
    const traceOpts: Record<string, unknown> = { name: opts.traceId || opts.name };
    if (opts.tags?.length) traceOpts.tags = opts.tags;
    if (opts.sessionId) traceOpts.sessionId = opts.sessionId;
    const trace = client.trace(traceOpts);

    const spanOpts: Record<string, unknown> = { name: opts.name };
    if (opts.metadata) spanOpts.metadata = opts.metadata;
    if (opts.level) spanOpts.level = opts.level;
    if (opts.statusMessage) spanOpts.statusMessage = opts.statusMessage;
    if (opts.durationMs !== undefined) {
      const endTime = new Date();
      spanOpts.endTime = endTime;
      spanOpts.startTime = new Date(endTime.getTime() - opts.durationMs);
    }
    const span = trace.span(spanOpts);
    span.end();
  } catch (e) {
    console.error("[langfuse] traceSpan failed:", e);
  }
}

/** Flush all pending events. Call before Deno.exit() or after a test. */
export async function flushLangfuse(): Promise<void> {
  const client = await getClient();
  if (!client) return;
  try {
    await client.flushAsync();
  } catch (e) {
    console.error("[langfuse] flush failed:", e);
  }
}
