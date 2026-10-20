import type { Config } from "../../types/config.js";
import { fingerprintSecret } from "../../config/secrets.js";
import { isPlainObject, stringAt } from "../../protocol/json-util.js";
import type { Protocol } from "../../types/config.js";
import { writeAdminError, writeAdminJSON } from "./responses.js";
import type { WebUIServer } from "./server.js";
import { apiKeyViews } from "./views.js";
import { RateLimiter } from "./rate-limiter.js";
import type { IncomingMessageLike, ResponseLike } from "./config-routes.js";

// The number of Playground requests allowed per client within the window.
const PLAYGROUND_LIMIT = 12;

// The length of the Playground rate-limit window, in milliseconds.
const PLAYGROUND_WINDOW_MS = 60 * 1000;

// The Playground rate limiter.
export const playgroundLimiter = new RateLimiter();

// handleUpdateKey renames, enables or deletes a local server key.
export async function handleUpdateKey(
  server: WebUIServer,
  request: IncomingMessageLike,
  response: ResponseLike,
  id: string,
): Promise<void> {
  const config = server.currentConfig();
  const index = config.server_keys.findIndex(
    (key) => fingerprintSecret(key) === id,
  );
  if (index < 0) {
    writeAdminError(
      response,
      400,
      "key_update_failed",
      "the API key does not exist",
    );
    return;
  }
  const body =
    request.method === "DELETE" ? {} : await readJSON(request);
  if (body === undefined) {
    writeAdminError(
      response,
      400,
      "invalid_request",
      "request body must be a JSON object",
    );
    return;
  }
  const updated: Config = {
    ...config,
    server_keys: [...config.server_keys],
    server_key_metadata: { ...config.server_key_metadata },
  };
  const meta = {
    ...(config.server_key_metadata[id] ?? { name: `Key ${index + 1}` }),
  };
  if (request.method === "DELETE") {
    if (enabledCount(config) <= 1) {
      writeAdminError(
        response,
        400,
        "key_delete_failed",
        "keep at least one enabled API key",
      );
      return;
    }
    updated.server_keys.splice(index, 1);
    delete updated.server_key_metadata[id];
  } else {
    const name = stringAt(body, "name").trim();
    if (name !== "") {
      if (name.length > 80) {
        writeAdminError(
          response,
          400,
          "key_update_failed",
          "the name must be 1-80 characters",
        );
        return;
      }
      meta.name = name;
    }
    if (body["enabled"] === false) {
      if (enabledCount(config) <= 1) {
        writeAdminError(
          response,
          400,
          "key_update_failed",
          "keep at least one enabled API key",
        );
        return;
      }
      meta.disabled = true;
    } else if (body["enabled"] === true) {
      delete meta.disabled;
    }
    updated.server_key_metadata[id] = meta;
  }
  server.gateway.apply(updated);
  writeAdminJSON(response, 200, { keys: apiKeyViews(updated) });
}

// handleDebugInference runs one Playground request in-process.
export async function handleDebugInference(
  server: WebUIServer,
  request: IncomingMessageLike,
  response: ResponseLike,
): Promise<void> {
  const ip = request.socket.remoteAddress ?? "unknown";
  if (
    !playgroundLimiter.allow(ip, PLAYGROUND_LIMIT, PLAYGROUND_WINDOW_MS)
  ) {
    writeAdminError(
      response,
      429,
      "debug_rate_limited",
      "too many Playground requests; retry in one minute",
    );
    return;
  }
  const body = await readJSON(request);
  if (body === undefined) {
    writeAdminError(
      response,
      400,
      "invalid_request",
      "request body must be a JSON object",
    );
    return;
  }
  const protocol = stringAt(body, "protocol");
  if (
    protocol !== "chat" &&
    protocol !== "responses" &&
    protocol !== "anthropic"
  ) {
    writeAdminError(
      response,
      400,
      "invalid_protocol",
      "protocol must be chat, responses, or anthropic",
    );
    return;
  }
  const payload = body["request"];
  if (!isPlainObject(payload)) {
    writeAdminError(
      response,
      400,
      "invalid_request",
      "request must be a JSON object",
    );
    return;
  }
  if (stringAt(payload, "model") === "") {
    writeAdminError(
      response,
      400,
      "invalid_request",
      "request.model is required",
    );
    return;
  }
  const config = server.currentConfig();
  const key = config.server_keys.find((entry) => enabledKey(config, entry));
  if (key === undefined) {
    writeAdminError(
      response,
      503,
      "debug_unavailable",
      "no local server key is configured",
    );
    return;
  }
  const started = Date.now();
  const result = await server.gateway.debugRequest(
    protocol as Protocol,
    payload,
    key,
  );
  writeAdminJSON(
    response,
    200,
    {
      ok: result.status >= 200 && result.status < 300,
      http_status: result.status,
      duration_ms: Date.now() - started,
      request_id: result.requestId,
      response: result.body,
    },
    true,
  );
}

// enabledKey reports whether a server key is enabled.
function enabledKey(config: Config, key: string): boolean {
  const meta = config.server_key_metadata[fingerprintSecret(key)];
  return meta?.disabled !== true;
}

// enabledCount reports how many server keys are enabled.
function enabledCount(config: Config): number {
  return config.server_keys.filter((key) => enabledKey(config, key)).length;
}

// readJSON reads a request body and decodes it.
async function readJSON(
  request: IncomingMessageLike,
): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > 2 * 1024 * 1024) {
      return undefined;
    }
    chunks.push(buffer);
  }
  if (total === 0) {
    return {};
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    return isPlainObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
