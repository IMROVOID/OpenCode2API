import type { IncomingMessage, ServerResponse } from "node:http";
import { isPlainObject, stringAt } from "../../protocol/json-util.js";
import { writeAdminError, writeAdminJSON } from "./responses.js";
import { authVersionOf } from "./session.js";
import { constantTimeEquals, type WebUIServer } from "./server.js";
import {
  apiKeyViews,
  configView,
  debugModelsPayload,
  monitorPayload,
  quotaPayload,
  rotationPayload,
} from "./views.js";
import {
  handleAccount,
  handleCreateKey,
  handleReveal,
  handleUpdateConfig,
  type IncomingMessageLike,
  type ResponseLike,
} from "./config-routes.js";
import { handleDebugInference, handleUpdateKey } from "./key-routes.js";
import { handleLogs, handleLogStream } from "./log-routes.js";
import { RateLimiter } from "./rate-limiter.js";

// The number of login failures allowed per client within the window.
const LOGIN_LIMIT = 5;

// The length of the login rate-limit window, in milliseconds.
const LOGIN_WINDOW_MS = 5 * 60 * 1000;

// The login rate limiter.
export const loginLimiter = new RateLimiter();

// handleAdminRequest serves one admin API request.
export async function handleAdminRequest(
  server: WebUIServer,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const method = request.method ?? "GET";
  const path = url.pathname;
  if (path === "/api/auth/login" && method === "POST") {
    await handleLogin(server, request, response);
    return;
  }
  if (path === "/api/auth/session" && method === "GET") {
    handleSession(server, request, response);
    return;
  }
  if (path === "/api/auth/logout" && method === "POST") {
    handleLogout(server, request, response);
    return;
  }
  const session = server.validSession(request);
  if (session === undefined) {
    writeAdminError(response, 401, "authentication_required", "login required");
    return;
  }
  if (method !== "GET" && method !== "HEAD") {
    const csrf = request.headers["x-csrf-token"];
    if (typeof csrf !== "string" || !constantTimeEquals(csrf, session.csrf)) {
      writeAdminError(response, 403, "csrf_failed", "CSRF token mismatch");
      return;
    }
    const origin = request.headers.origin;
    if (typeof origin === "string" && origin !== "") {
      if (!originAllowed(origin, request, server.isSecure(request))) {
        writeAdminError(response, 403, "origin_failed", "origin not allowed");
        return;
      }
    }
  }
  if (path === "/api/config" && method === "GET") {
    writeAdminJSON(response, 200, configView(server.currentConfig()), true);
    return;
  }
  if (path === "/api/config" && method === "PUT") {
    await handleUpdateConfig(
      server,
      request as unknown as IncomingMessageLike,
      response as unknown as ResponseLike,
    );
    return;
  }
  if (path === "/api/config/reload" && method === "POST") {
    writeAdminJSON(response, 200, { applied: true, restart_required: false });
    return;
  }
  if (path === "/api/config/reveal" && method === "POST") {
    await handleReveal(
      server,
      request as unknown as IncomingMessageLike,
      response as unknown as ResponseLike,
    );
    return;
  }
  if (path === "/api/account" && method === "PUT") {
    await handleAccount(
      server,
      request as unknown as IncomingMessageLike,
      response as unknown as ResponseLike,
    );
    return;
  }
  if (path === "/api/monitor" && method === "GET") {
    writeAdminJSON(response, 200, monitorPayload(server));
    return;
  }
  if (path === "/api/debug/models" && method === "GET") {
    writeAdminJSON(response, 200, debugModelsPayload(server), true);
    return;
  }
  if (path === "/api/api-keys" && method === "GET") {
    writeAdminJSON(
      response,
      200,
      { keys: apiKeyViews(server.currentConfig()) },
      true,
    );
    return;
  }
  if (path === "/api/api-keys" && method === "POST") {
    await handleCreateKey(
      server,
      request as unknown as IncomingMessageLike,
      response as unknown as ResponseLike,
    );
    return;
  }
  if (
    path.startsWith("/api/api-keys/") &&
    (method === "PATCH" || method === "DELETE")
  ) {
    await handleUpdateKey(
      server,
      request as unknown as IncomingMessageLike,
      response as unknown as ResponseLike,
      path.slice("/api/api-keys/".length),
    );
    return;
  }
  if (path === "/api/models/availability" && method === "GET") {
    writeAdminJSON(response, 200, { models: [] }, true);
    return;
  }
  if (path === "/api/rotation" && method === "GET") {
    writeAdminJSON(response, 200, rotationPayload(server), true);
    return;
  }
  if (path === "/api/model-quotas" && method === "GET") {
    writeAdminJSON(response, 200, quotaPayload(server), true);
    return;
  }
  if (path === "/api/debug/inference" && method === "POST") {
    await handleDebugInference(
      server,
      request as unknown as IncomingMessageLike,
      response as unknown as ResponseLike,
    );
    return;
  }
  if (path === "/api/logs" && method === "GET") {
    handleLogs(server, response, url);
    return;
  }
  if (path === "/api/logs/stream" && method === "GET") {
    handleLogStream(server, request, response, url);
    return;
  }
  writeAdminError(
    response,
    404,
    "not_found",
    "management endpoint not found",
  );
}

// handleLogin authenticates a client and issues a session.
async function handleLogin(
  server: WebUIServer,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const ip = clientIP(request);
  if (!loginLimiter.allow(ip, LOGIN_LIMIT, LOGIN_WINDOW_MS)) {
    writeAdminError(
      response,
      429,
      "rate_limited",
      "too many login attempts; try again later",
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
  const username = stringAt(body, "username");
  const password = stringAt(body, "password");
  if (!server.checkCredentials(username, password)) {
    writeAdminError(
      response,
      401,
      "invalid_credentials",
      "invalid username or password",
    );
    return;
  }
  loginLimiter.reset(ip);
  const ttl = server.currentConfig().webui.session_ttl_minutes;
  const { token, csrf } = server.sessions.create(
    username,
    authVersionOf(server.currentConfig()),
    ttl,
  );
  response.setHeader(
    "Set-Cookie",
    server.sessionCookie(token, ttl * 60, server.isSecure(request)),
  );
  writeAdminJSON(
    response,
    200,
    { username, csrf_token: csrf, expires_in: ttl * 60 },
    true,
  );
}

// handleSession reports the session a request carries.
function handleSession(
  server: WebUIServer,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const session = server.validSession(request);
  if (session === undefined) {
    writeAdminError(
      response,
      401,
      "authentication_required",
      "session expired or invalid",
    );
    return;
  }
  writeAdminJSON(
    response,
    200,
    {
      username: session.username,
      csrf_token: session.csrf,
      expires_in: Math.max(
        0,
        Math.floor((session.expires - Date.now()) / 1000),
      ),
    },
    true,
  );
}

// handleLogout ends a session.
function handleLogout(
  server: WebUIServer,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const token = server.tokenFrom(request);
  server.sessions.drop(token);
  response.setHeader("Set-Cookie", server.clearCookie(server.isSecure(request)));
  writeAdminJSON(response, 200, { ok: true });
}

// readJSON reads a request body and decodes it.
async function readJSON(
  request: IncomingMessage,
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

// clientIP reads the client address of a request.
function clientIP(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? "unknown";
}

// originAllowed reports whether a request's origin matches its host.
function originAllowed(
  origin: string,
  request: IncomingMessage,
  secure: boolean,
): boolean {
  try {
    const parsed = new URL(origin);
    const host = request.headers.host ?? "";
    if (parsed.host.toLowerCase() !== host.toLowerCase()) {
      return false;
    }
    return parsed.protocol === (secure ? "https:" : "http:");
  } catch {
    return false;
  }
}
