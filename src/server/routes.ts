import type { ServerResponse } from "node:http";
import type { Protocol } from "../types/config.js";
import { isPlainObject, sliceAt, stringAt } from "../protocol/json-util.js";
import { RequestDispatcher, type RouteContext } from "./dispatcher.js";
import { serverKeyScope, type Gateway } from "./gateway.js";

// registerRoutes wires the public API routes onto a dispatcher.
export function registerRoutes(dispatcher: RequestDispatcher, gateway: Gateway): void {
  dispatcher.register({
    method: "GET",
    path: "/healthz",
    protocol: "chat",
    public: true,
    handler: (context) => {
      writeJSON(context.response, 200, healthPayload(gateway));
    },
  });
  dispatcher.register({
    method: "GET",
    path: "/v1/models",
    protocol: "chat",
    handler: (context) => {
      writeJSON(context.response, 200, modelsPayload(gateway));
    },
  });
  for (const [path, protocol] of [
    ["/v1/chat/completions", "chat"],
    ["/v1/responses", "responses"],
    ["/v1/messages", "anthropic"],
    ["/v1/systemone", "systemone"],
  ] as const) {
    dispatcher.register({
      method: "POST",
      path,
      protocol,
      handler: (context) => {
        void handleCompletion(context, gateway, protocol);
      },
    });
  }
}

// handleCompletion serves one completion request.
async function handleCompletion(
  context: RouteContext,
  gateway: Gateway,
  protocol: Protocol,
): Promise<void> {
  const scope = serverKeyScope(gateway.serverKeys()[0] ?? "");
  await gateway.handleCompletion(
    protocol,
    context.body,
    context.request.headers,
    context.response,
    scope,
  );
}

// healthPayload renders the health document.
function healthPayload(gateway: Gateway): Record<string, unknown> {
  const config = gateway.current();
  const snapshot = gateway.catalog.snapshot();
  return {
    status: "ok",
    version: "dev",
    uptime_seconds: Math.trunc(process.uptime()),
    models: {
      total: snapshot.total,
      exposed: snapshot.exposed,
      zen: snapshot.zen,
      go: snapshot.go,
      stale: snapshot.stale,
    },
    keys: {
      zen: config.zen_keys.length,
      go: config.go_keys.length,
      server: config.server_keys.length,
    },
    anonymous: config.anonymous,
  };
}

// modelsPayload renders the model listing. Every model the catalog exposes
// carries its native protocol and the endpoints it can be served on.
function modelsPayload(gateway: Gateway): Record<string, unknown> {
  const { routes, snapshot } = gateway.catalog.availableModels(
    gateway.hasZenKeys(),
    gateway.hasGoKeys(),
    gateway.current().anonymous,
  );
  const created = Math.floor(Date.now() / 1000);
  const data = routes.map((route) => {
    const metadata = gateway.catalog.metadataForTier(route.id, route.tier);
    const entry: Record<string, unknown> = {
      id: route.id,
      object: "model",
      created,
      owned_by: "opencode",
    };
    if (metadata.contextWindow > 0) {
      entry["context_window"] = metadata.contextWindow;
      entry["context_length"] = metadata.contextWindow;
    }
    if (metadata.maxInput > 0) {
      entry["max_input"] = metadata.maxInput;
    }
    if (metadata.maxOutput > 0) {
      entry["max_output"] = metadata.maxOutput;
    }
    if (metadata.reasoning) {
      entry["reasoning"] = true;
      entry["supports_reasoning"] = true;
      entry["reasoning_efforts"] = [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ];
    }
    if (metadata.toolCall) {
      entry["tool_call"] = true;
    }
    if (metadata.structuredOutput) {
      entry["structured_output"] = true;
    }
    entry["native_protocol"] = route.protocol;
    entry["supported_endpoints"] = [
      "/v1/chat/completions",
      "/v1/responses",
      "/v1/messages",
    ];
    return entry;
  });
  return { object: "list", data, total: snapshot.total, exposed: snapshot.exposed };
}

// writeJSON answers a request with a JSON document.
export function writeJSON(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const text = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  response.end(text);
}

// modelIDs reads the model ids of a listing payload.
export function modelIDs(payload: unknown): string[] {
  const ids: string[] = [];
  for (const raw of sliceAt(payload, "data")) {
    const id = stringAt(raw, "id");
    if (id !== "") {
      ids.push(id);
    }
  }
  return ids;
}

// isPayloadObject reports whether a decoded body is a JSON object.
export function isPayloadObject(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}
