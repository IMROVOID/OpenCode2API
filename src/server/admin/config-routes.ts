import { randomBytes } from "node:crypto";
import type { Config } from "../../types/config.js";
import { fingerprintSecret } from "../../config/secrets.js";
import { isPlainObject, stringAt } from "../../protocol/json-util.js";
import type { LogLevel } from "../../types/config.js";
import { hashPassword, type WebUIServer } from "./server.js";
import { writeAdminError, writeAdminJSON, type AdminResponse } from "./responses.js";
import { configView } from "./views.js";

// handleUpdateConfig applies a configuration change. The running
// configuration is validated before it is swapped, so a rejected change leaves
// the proxy untouched.
export async function handleUpdateConfig(
  server: WebUIServer,
  request: IncomingMessageLike,
  response: ResponseLike,
): Promise<void> {
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
  const current = server.currentConfig();
  const upstream = body["upstream"];
  const updated: Config = {
    ...current,
    listen: stringOr(body["listen"], current.listen),
    anonymous: booleanOr(body["anonymous"], current.anonymous),
    proxyfile: stringOr(body["proxyfile"], current.proxyfile),
    upstream: {
      zen: stringOr(stringAt(upstream, "zen"), current.upstream.zen),
      go: stringOr(stringAt(upstream, "go"), current.upstream.go),
      anonymous: stringOr(
        stringAt(upstream, "anonymous"),
        current.upstream.anonymous,
      ),
    },
    prefer:
      body["prefer"] === "zen"
        ? "zen"
        : body["prefer"] === "go"
          ? "go"
          : current.prefer,
  };
  const retry = body["retry"];
  if (isPlainObject(retry)) {
    updated.retry = {
      max_attempts: numberOr(
        retry["max_attempts"],
        current.retry.max_attempts,
      ),
      timeout_seconds: numberOr(
        retry["timeout_seconds"],
        current.retry.timeout_seconds,
      ),
    };
  }
  const models = body["models"];
  if (isPlainObject(models)) {
    updated.models = {
      refresh_seconds: numberOr(
        models["refresh_seconds"],
        current.models.refresh_seconds,
      ),
      protocols: isPlainObject(models["protocols"])
        ? (models["protocols"] as Record<string, string>)
        : current.models.protocols,
      free_only: booleanOr(models["free_only"], current.models.free_only),
    };
  }
  const logging = body["logging"];
  if (isPlainObject(logging)) {
    const level = stringAt(logging, "level");
    updated.logging = {
      level: isLogLevel(level) ? (level as LogLevel) : current.logging.level,
      ring_size: numberOr(logging["ring_size"], current.logging.ring_size),
      dump_request_bodies: booleanOr(
        logging["dump_request_bodies"],
        current.logging.dump_request_bodies,
      ),
    };
  }
  server.gateway.apply(updated);
  writeAdminJSON(
    response,
    200,
    {
      result: { applied: true, restart_required: false, restart_fields: [] },
      config: configView(updated),
    },
  );
}

// handleReveal returns the plaintext secrets after a password check.
export async function handleReveal(
  server: WebUIServer,
  request: IncomingMessageLike,
  response: ResponseLike,
): Promise<void> {
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
  const config = server.currentConfig();
  if (
    !server.checkCredentials(config.webui.username, stringAt(body, "password"))
  ) {
    writeAdminError(
      response,
      403,
      "verification_failed",
      "password verification failed",
    );
    return;
  }
  writeAdminJSON(
    response,
    200,
    {
      server_keys: config.server_keys,
      zen_keys: config.zen_keys,
      go_keys: config.go_keys,
      proxies: config.proxies,
    },
    true,
  );
}

// handleAccount changes the WebUI credentials. Every session is dropped, so
// the operator signs in again.
export async function handleAccount(
  server: WebUIServer,
  request: IncomingMessageLike,
  response: ResponseLike,
): Promise<void> {
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
  const current = server.currentConfig();
  if (
    !server.checkCredentials(
      current.webui.username,
      stringAt(body, "current_password"),
    )
  ) {
    writeAdminError(
      response,
      403,
      "verification_failed",
      "current password is incorrect",
    );
    return;
  }
  const username = stringAt(body, "username").trim();
  const newPassword = stringAt(body, "new_password");
  const webui = {
    ...current.webui,
    username: username !== "" ? username : current.webui.username,
  };
  if (newPassword !== "") {
    webui.password_hash = hashPassword(newPassword);
    delete webui.password;
  }
  const updated: Config = { ...current, webui };
  server.gateway.apply(updated);
  server.sessions.dropAll();
  response.setHeader("Set-Cookie", server.clearCookie(server.isSecure(request as never)));
  writeAdminJSON(response, 200, { updated: true, reauthenticate: true });
}

// handleCreateKey adds a local server key.
export async function handleCreateKey(
  server: WebUIServer,
  request: IncomingMessageLike,
  response: ResponseLike,
): Promise<void> {
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
  const config = server.currentConfig();
  const name = stringAt(body, "name").trim();
  if (name.length < 1 || name.length > 80) {
    writeAdminError(
      response,
      400,
      "key_create_failed",
      "the name must be 1-80 characters",
    );
    return;
  }
  const value = stringAt(body, "value").trim();
  const key = value !== "" ? value : `sk-local-${randomBytes(24).toString("hex")}`;
  if (key.length < 16 || key.length > 256) {
    writeAdminError(
      response,
      400,
      "key_create_failed",
      "a custom key must be 16-256 characters",
    );
    return;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(key)) {
    writeAdminError(
      response,
      400,
      "key_create_failed",
      "a key may only hold letters, digits, dashes, underscores and dots",
    );
    return;
  }
  if (config.server_keys.length >= 200) {
    writeAdminError(
      response,
      400,
      "key_create_failed",
      "at most 200 API keys are allowed",
    );
    return;
  }
  const id = fingerprintSecret(key);
  if (config.server_keys.some((existing) => fingerprintSecret(existing) === id)) {
    writeAdminError(
      response,
      400,
      "key_create_failed",
      "this API key already exists",
    );
    return;
  }
  const updated: Config = {
    ...config,
    server_keys: [...config.server_keys, key],
    server_key_metadata: {
      ...config.server_key_metadata,
      [id]: { name, created_at: new Date().toISOString() },
    },
  };
  server.gateway.apply(updated);
  writeAdminJSON(response, 201, { key, keys: apiKeyViewsOf(updated) }, true);
}

// The request and the response shapes the admin handlers work with. They are
// looser than Node's types so the handlers stay testable.
export interface IncomingMessageLike {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string; encrypted?: boolean };
  on: (event: string, listener: () => void) => void;
  [Symbol.asyncIterator](): AsyncIterator<Buffer>;
}

export type ResponseLike = AdminResponse;

// apiKeyViewsOf renders the local server keys.
function apiKeyViewsOf(config: Config): Record<string, unknown>[] {
  return config.server_keys.map((key, index) => {
    const id = fingerprintSecret(key);
    const meta = config.server_key_metadata[id];
    return {
      id,
      name: meta?.name ?? `Key ${index + 1}`,
      display: `••••${key.slice(-5)}`,
      enabled: meta?.disabled !== true,
      created_at: meta?.created_at,
      usage: { lifetime: { requests: 0 }, last_hour: { requests: 0 } },
    };
  });
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
    if (total > ADMIN_BODY_LIMIT) {
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

// The body limit an admin request may carry.
const ADMIN_BODY_LIMIT = 2 * 1024 * 1024;

// stringOr reads a string value, falling back to a default.
function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

// numberOr reads a number value, falling back to a default.
function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// booleanOr reads a boolean value, falling back to a default.
function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

// isLogLevel reports whether a value is a log level.
function isLogLevel(value: string): boolean {
  return (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  );
}
