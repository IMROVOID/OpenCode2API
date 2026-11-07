import type { Protocol } from "../types/config.js";
import { collapseStream } from "../protocol/collapse.js";
import { convertRequest } from "../protocol/convert.js";
import { V2_USER_AGENT } from "../protocol/lanes.js";
import { convertResponse, renameResponseTool } from "../protocol/response.js";
import { V1_READ_TOOL } from "../protocol/tools.js";
import type { UpstreamRequest } from "../protocol/upstream-request.js";

export const KILO_GATEWAY_BASE = "https://api.kilo.ai/api/gateway";
export const KILO_ANONYMOUS_TOKEN = "anonymous";

// Built-in free models across OpenCode Zen v2.2.5 and Kilo Free Gateway.
export const BUILTIN_FREE_MODELS = [
  "beam-free",
  "deepseek-v4.1-flash-free",
  "glm-5.3-flash-free",
  "mimo-v2.6-flash-free",
  "nemotron-3.5-super-vl-free",
  "nemotron-3.5-lightning-free",
  "flint-40b-free",
  "big-pickle",
  "crouton-alpha-free",
  "iceman-free",
  "inkling-2-small-free",
  "kilo-auto/free",
  "reflection/beam-free",
  "nvidia/nemotron-3.5-super-vl:free",
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "cohere/north-mini-code:free",
  "dots-studio/dots-3-note-preview:free",
  "stealth/crouton-alpha",
  "stealth/glyph-cluster",
  "liquid/lfm-3-1.7b:free",
  "openrouter/free",
] as const;

const KILO_DEFAULT_CHAIN = [
  "reflection/beam-free",
  "kilo-auto/free",
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3.5-super-vl:free",
  "cohere/north-mini-code:free",
  "stealth/crouton-alpha",
  "openrouter/free",
] as const;

const KILO_EQUIVALENTS: Readonly<Record<string, string>> = {
  "beam-free": "reflection/beam-free",
  "nemotron-3.5-lightning-free": "nvidia/nemotron-3.5-lightning:free",
  "nemotron-3.5-super-vl-free": "nvidia/nemotron-3.5-super-vl:free",
  "nemotron-3-super-free": "nvidia/nemotron-3.5-super-vl:free",
  "crouton-alpha-free": "stealth/crouton-alpha",
  "flint-40b-free": "openrouter/free",
  "deepseek-v4.1-flash-free": "cohere/north-mini-code:free",
  "deepseek-v4.1-flash": "cohere/north-mini-code:free",
  "north-mini-code-free": "cohere/north-mini-code:free",
  "glm-5.3-flash-free": "reflection/beam-free",
  "glm-5.3": "reflection/beam-free",
  "glm-5-free": "reflection/beam-free",
  "mimo-v2.6-flash-free": "reflection/beam-free",
  "mimo-v2-pro-free": "reflection/beam-free",
  "mimo-v2-omni-free": "reflection/beam-free",
  "minimax-m2.5-free": "reflection/beam-free",
  "minimax-m2.5": "reflection/beam-free",
  "big-pickle": "reflection/beam-free",
  "auto": "reflection/beam-free",
  "main": "reflection/beam-free",
  "fast": "reflection/beam-free",
  "sota": "reflection/beam-free",
  "sweet": "reflection/beam-free",
  "deep": "cohere/north-mini-code:free",
  "code": "cohere/north-mini-code:free",
  "vision": "nvidia/nemotron-3.5-super-vl:free",
  "vl": "nvidia/nemotron-3.5-super-vl:free",
};

const OPENCODE_FREE_EQUIVALENTS: Readonly<Record<string, string>> = {
  "glm-5-free": "glm-5.3-flash-free",
  "glm-5.3": "glm-5.3-flash-free",
  "deepseek-v4.1-flash": "deepseek-v4.1-flash-free",
  "mimo-v2-pro-free": "mimo-v2.6-flash-free",
  "mimo-v2-omni-free": "mimo-v2.6-flash-free",
  "nemotron-3-super-free": "nemotron-3.5-super-vl-free",
  "minimax-m2.5-free": "beam-free",
  "minimax-m2.5": "beam-free",
  "kimi-k2.5-free": "beam-free",
  "kimi-k3": "beam-free",
  "qwen3.6-plus-free": "beam-free",
  "qwen3.8-max": "beam-free",
  "grok-4.6": "beam-free",
  "gpt-5-nano": "beam-free",
  "auto": "beam-free",
  "main": "beam-free",
  "fast": "beam-free",
  "sota": "beam-free",
  "sweet": "beam-free",
  "deep": "deepseek-v4.1-flash-free",
  "code": "deepseek-v4.1-flash-free",
  "vision": "nemotron-3.5-super-vl-free",
  "vl": "nemotron-3.5-super-vl-free",
  "reflection/beam-free": "beam-free",
  "nvidia/nemotron-3.5-lightning:free": "nemotron-3.5-lightning-free",
  "nvidia/nemotron-3.5-super-vl:free": "nemotron-3.5-super-vl-free",
  "stealth/crouton-alpha": "crouton-alpha-free",
};

function stripModelDecorators(raw: string): string {
  let base = raw.trim();
  const parenIndex = base.lastIndexOf("(");
  if (parenIndex > 0 && base.endsWith(")")) {
    base = base.slice(0, parenIndex).trim();
  }
  if (base.startsWith("opencode/")) {
    return base.slice("opencode/".length);
  }
  if (base.startsWith("kilo/")) {
    return base.slice("kilo/".length);
  }
  return base;
}

// isKiloModelId reports whether a model ID natively targets the Kilo Free Gateway.
export function isKiloModelId(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.startsWith("kilo/")) {
    return true;
  }
  const clean = stripModelDecorators(trimmed);
  return clean.includes("/") || clean.endsWith(":free");
}

// resolveOpenCodeFreeModel maps aliases and retired v1 free model IDs onto
// active OpenCode Zen v2.2.5 free model IDs.
export function resolveOpenCodeFreeModel(raw: string): string {
  const clean = stripModelDecorators(raw);
  return OPENCODE_FREE_EQUIVALENTS[clean] ?? clean;
}

// kiloFallbackChain returns the ordered list of Kilo Free Gateway model IDs
// to try when failing over from an OpenCode Zen quota wall.
export function kiloFallbackChain(raw: string): string[] {
  const clean = stripModelDecorators(raw);
  const chain: string[] = [];
  if (isKiloModelId(raw)) {
    chain.push(clean);
  } else {
    const mapped = KILO_EQUIVALENTS[clean];
    if (mapped !== undefined) {
      chain.push(mapped);
    }
  }
  for (const fallback of KILO_DEFAULT_CHAIN) {
    if (!chain.includes(fallback)) {
      chain.push(fallback);
    }
  }
  return chain;
}

// buildKiloUpstreamRequest formats an OpenAI-compatible request for the
// keyless Kilo Free Gateway.
export function buildKiloUpstreamRequest(
  kiloModel: string,
  protocol: Protocol,
  payload: Record<string, unknown>,
  stream: boolean,
  baseURL: string = KILO_GATEWAY_BASE,
): UpstreamRequest {
  const converted =
    protocol === "chat" || protocol === "systemone"
      ? { ...payload }
      : convertRequest(protocol, "chat", payload);
  const bodyObj: Record<string, unknown> = {
    ...converted,
    model: kiloModel,
    stream,
  };
  const headers = new Headers({
    Authorization: `Bearer ${KILO_ANONYMOUS_TOKEN}`,
    "Content-Type": "application/json",
    Accept: stream ? "text/event-stream" : "application/json",
    "User-Agent": V2_USER_AGENT,
  });
  const url = `${baseURL.replace(/\/+$/, "")}/v1/chat/completions`;
  return {
    url,
    headers,
    body: JSON.stringify(bodyObj),
  };
}

// normalizeUnlimitedResponse collapses SSE to JSON when the client requested
// stream: false and converts protocol shapes when served via a fallback lane.
export async function normalizeUnlimitedResponse(
  response: Response,
  upstreamProtocol: Protocol,
  clientProtocol: Protocol,
  requestedModel: string,
  alias: string,
  clientWantsStream: boolean,
): Promise<Response> {
  if (clientWantsStream) {
    return response;
  }
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const rawText = await response.text();
  const trimmed = rawText.trimStart();
  const isSSE =
    contentType.includes("text/event-stream") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("event:");
  let jsonText = rawText;
  if (isSSE) {
    const bytes = new TextEncoder().encode(`${rawText}\n\n`);
    const stream = {
      async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        yield bytes;
      },
    };
    jsonText = await collapseStream(stream, upstreamProtocol, requestedModel);
  }
  if (alias !== "") {
    jsonText = renameResponseTool(jsonText, upstreamProtocol, V1_READ_TOOL, alias);
  }
  if (upstreamProtocol !== clientProtocol) {
    jsonText = convertResponse(upstreamProtocol, clientProtocol, jsonText);
  }
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json");
  return new Response(jsonText, { status: response.status, headers });
}
