import type { Protocol } from "../types/config.js";
import { buildUpstreamRequest } from "../protocol/upstream-request.js";
import { canonicalSessionID, randomID, type RequestIDs } from "../protocol/identity.js";
import { deriveRequestIDs } from "../protocol/request-identity.js";
import { isV1Upstream } from "../protocol/lanes.js";
import { prepareAnonymousBody } from "../protocol/tools.js";
import { buildErrorEnvelope } from "../protocol/error.js";
import { WEBUI_HTML } from "../webui/document.js";

// The environment the Worker reads its configuration from.
export interface WorkerEnv {
  API_KEY?: string;
  OPENCODE_ZEN_KEYS?: string;
  OPENCODE_GO_KEYS?: string;
  UPSTREAM_ZEN?: string;
  UPSTREAM_GO?: string;
  UPSTREAM_ANONYMOUS?: string;
  ADMIN_PASSWORD?: string;
  WEBUI_ENABLED?: string;
}

// The CORS headers the Worker answers with.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-api-key, x-opencode-session, x-opencode-session-id, x-session-affinity, x-session-id, x-opencode-request, x-opencode-project, x-parent-session-id, x-opencode-client, Accept",
  "Access-Control-Max-Age": "86400",
};

// The default upstream lanes.
const DEFAULT_ZEN = "https://opencode.ai/zen";
const DEFAULT_GO = "https://opencode.ai/zen/go";

// The Worker serves the API and, when it is enabled, the control WebUI.
export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
  ): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      return jsonResponse(
        {
          error: {
            message: error instanceof Error ? error.message : "internal error",
            type: "server_error",
            param: null,
            code: null,
          },
        },
        500,
      );
    }
  },
};

// handle serves one request.
async function handle(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    if (!webuiEnabled(env)) {
      return jsonResponse({ error: { message: "not found" } }, 404);
    }
    return new Response(WEBUI_HTML, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...CORS_HEADERS,
      },
    });
  }
  if (url.pathname === "/v1/health" || url.pathname === "/healthz") {
    return jsonResponse({ status: "ok", version: "dev" });
  }
  if (url.pathname === "/v1/models") {
    if (!authorized(request, env)) {
      return unauthorized();
    }
    return modelsResponse(env);
  }
  const protocol = protocolFor(url.pathname);
  if (protocol === undefined) {
    return jsonResponse({ error: { message: "not found" } }, 404);
  }
  if (!authorized(request, env)) {
    return unauthorized();
  }
  const text = await request.text();
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return errorResponse(protocol, 400, "request body must be a JSON object", "invalid_request_error");
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return errorResponse(protocol, 400, "request body must be a JSON object", "invalid_request_error");
  }
  const model = typeof payload["model"] === "string" ? payload["model"] : "";
  if (model === "") {
    return errorResponse(protocol, 400, "model is required", "invalid_request_error");
  }
  return forward(request, env, protocol, payload);
}

// forward sends the request to the upstream lane and returns its answer.
async function forward(
  request: Request,
  env: WorkerEnv,
  protocol: Protocol,
  payload: Record<string, unknown>,
): Promise<Response> {
  const ids = deriveRequestIDs(
    headersToDict(request.headers),
    payload,
    "worker",
  );
  const tier = pickTier(env);
  const key = tier === "go" ? firstKey(env.OPENCODE_GO_KEYS) : firstKey(env.OPENCODE_ZEN_KEYS);
  const baseURL = baseURLFor(env, tier);
  const body = shapeBody(JSON.stringify(payload), protocol, baseURL);
  const upstream = buildUpstreamRequest(baseURL, protocol, body, ids, key);
  const response = await fetch(upstream.url, {
    method: "POST",
    headers: upstream.headers,
    body: upstream.body,
  });
  const headers = new Headers(response.headers);
  headers.set("x-request-id", ids.request);
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

// shapeBody applies the upstream gate's request shaping to a body.
function shapeBody(
  body: string,
  protocol: Protocol,
  baseURL: string,
): string {
  const prepared = prepareAnonymousBody(body, protocol, isV1Upstream(baseURL));
  return prepared.body;
}

// pickTier chooses the lane a request is served on.
function pickTier(env: WorkerEnv): "zen" | "go" {
  if (firstKey(env.OPENCODE_GO_KEYS) !== "") {
    return "go";
  }
  return "zen";
}

// baseURLFor returns the base URL of a lane.
function baseURLFor(env: WorkerEnv, tier: "zen" | "go"): string {
  if (tier === "go") {
    return env.UPSTREAM_GO ?? DEFAULT_GO;
  }
  return env.UPSTREAM_ZEN ?? DEFAULT_ZEN;
}

// firstKey returns the first key of a comma-separated list.
function firstKey(value: string | undefined): string {
  if (value === undefined) {
    return "";
  }
  for (const part of value.split(",")) {
    const key = part.trim();
    if (key !== "") {
      return key;
    }
  }
  return "";
}

// authorized reports whether a request carries the configured API key.
function authorized(request: Request, env: WorkerEnv): boolean {
  const expected = env.API_KEY ?? "";
  if (expected === "") {
    return true;
  }
  const header = request.headers.get("x-api-key");
  if (header !== null && header === expected) {
    return true;
  }
  const authorization = request.headers.get("authorization");
  if (authorization === null) {
    return false;
  }
  return authorization.toLowerCase().startsWith("bearer ") &&
    authorization.slice(7).trim() === expected;
}

// webuiEnabled reports whether the control WebUI is served.
function webuiEnabled(env: WorkerEnv): boolean {
  return (env.WEBUI_ENABLED ?? "true").toLowerCase() !== "false";
}

// modelsResponse lists the models of the configured lane.
async function modelsResponse(env: WorkerEnv): Promise<Response> {
  const tier = pickTier(env);
  const baseURL = baseURLFor(env, tier);
  const key = tier === "go" ? firstKey(env.OPENCODE_GO_KEYS) : firstKey(env.OPENCODE_ZEN_KEYS);
  try {
    const response = await fetch(`${baseURL.replace(/\/+$/, "")}/v1/models`, {
      headers: {
        Authorization: `Bearer ${key}`,
        "User-Agent": "opencode/latest/2.0.32/cli",
        "x-opencode-client": "cli",
      },
    });
    if (!response.ok) {
      return jsonResponse({ error: { message: "models endpoint failed" } }, 502);
    }
    const payload = (await response.json()) as unknown;
    return jsonResponse(payload);
  } catch {
    return jsonResponse({ error: { message: "models endpoint unreachable" } }, 502);
  }
}

// protocolFor returns the protocol a path serves.
function protocolFor(path: string): Protocol | undefined {
  switch (path) {
    case "/v1/chat/completions":
      return "chat";
    case "/v1/responses":
      return "responses";
    case "/v1/messages":
      return "anthropic";
    case "/v1/systemone":
      return "systemone";
    default:
      return undefined;
  }
}

// headersToDict converts a header map into the plain object the identity
// helpers read.
function headersToDict(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    result[name] = value;
  });
  return result;
}

// jsonResponse answers with a JSON document.
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

// unauthorized answers with the authentication error.
function unauthorized(): Response {
  return jsonResponse(
    {
      error: {
        message: "invalid API key",
        type: "authentication_error",
        param: null,
        code: null,
      },
    },
    401,
  );
}

// errorResponse answers with a protocol's error envelope.
function errorResponse(
  protocol: Protocol,
  status: number,
  message: string,
  kind: string,
): Response {
  const envelope = buildErrorEnvelope(protocol, status, message, kind as never);
  return jsonResponse(envelope.body, envelope.status);
}

export { canonicalSessionID, randomID, type RequestIDs };
