import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { buildErrorEnvelope } from "../protocol/error.js";
import type { Protocol } from "../types/config.js";

// The body limit a client request may carry.
export const MAX_REQUEST_BODY = 32 * 1024 * 1024;

// The CORS headers the API answers with.
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, x-opencode-session, x-opencode-session-id, x-session-affinity, x-session-id, x-opencode-request, x-opencode-project, x-parent-session-id, x-opencode-client, Accept",
  "Access-Control-Max-Age": "86400",
};

// RouteContext is what a route handler receives.
export interface RouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  protocol: Protocol;
  body: Buffer;
}

// RouteHandler serves one route.
export type RouteHandler = (context: RouteContext) => Promise<void> | void;

// Route is one registered route.
export interface Route {
  method: string;
  path: string;
  protocol: Protocol;
  handler: RouteHandler;
  // public routes skip the client authentication, like the health check.
  public?: boolean;
}

// RequestDispatcher routes the client requests to their handlers. It applies
// the CORS preflight, the client authentication and the body limit before the
// handler runs.
export class RequestDispatcher {
  private readonly routes: Route[] = [];
  private readonly authKeys: () => string[];

  constructor(authKeys: () => string[]) {
    this.authKeys = authKeys;
  }

  // register adds a route.
  register(route: Route): void {
    this.routes.push(route);
  }

  // dispatch serves one request.
  async dispatch(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    for (const [name, value] of Object.entries(CORS_HEADERS)) {
      response.setHeader(name, value);
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    const route = this.match(request.method ?? "GET", url.pathname);
    if (route === undefined) {
      this.writeError(response, "chat", 404, "not found", "invalid_request_error");
      return;
    }
    if (route.public !== true && !this.authorized(request)) {
      this.writeError(
        response,
        route.protocol,
        401,
        "invalid API key",
        "authentication_error",
      );
      return;
    }
    let body: Buffer;
    try {
      body = await readBody(request);
    } catch (error) {
      this.writeError(
        response,
        route.protocol,
        400,
        error instanceof Error ? error.message : "request body is too large",
        "invalid_request_error",
      );
      return;
    }
    try {
      await route.handler({ request, response, url, protocol: route.protocol, body });
    } catch (error) {
      this.writeError(
        response,
        route.protocol,
        500,
        error instanceof Error ? error.message : "internal error",
        "server_error",
      );
    }
  }

  // match finds the route for a method and path.
  private match(method: string, path: string): Route | undefined {
    return this.routes.find(
      (route) => route.method === method && route.path === path,
    );
  }

  // authorized reports whether the request carries a valid client key. A
  // server with no keys configured serves every request.
  private authorized(request: IncomingMessage): boolean {
    const keys = this.authKeys();
    if (keys.length === 0) {
      return true;
    }
    const presented = clientKey(request);
    if (presented === "") {
      return false;
    }
    return keys.some((key) => constantTimeEquals(key, presented));
  }

  // writeError answers a request with the protocol's error envelope.
  private writeError(
    response: ServerResponse,
    protocol: Protocol,
    status: number,
    message: string,
    kind: string,
  ): void {
    const envelope = buildErrorEnvelope(protocol, status, message, kind as never);
    const body = `${JSON.stringify(envelope.body)}\n`;
    response.writeHead(envelope.status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    response.end(body);
  }
}

// clientKey reads the client key from the request.
export function clientKey(request: IncomingMessage): string {
  const apiKey = request.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey !== "") {
    return apiKey;
  }
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") {
    return "";
  }
  const prefix = "bearer ";
  if (!authorization.toLowerCase().startsWith(prefix)) {
    return "";
  }
  return authorization.slice(prefix.length).trim();
}

// constantTimeEquals compares two secrets without leaking their length
// through the timing.
export function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

// readBody reads the request body, bounded by the body limit.
export async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BODY) {
      throw new Error("request body is too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

// startServer starts the API server and returns it.
export function startServer(
  dispatcher: RequestDispatcher,
  listen: string,
): Promise<Server> {
  const server = createServer((request, response) => {
    void dispatcher.dispatch(request, response);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    const { host, port } = parseListen(listen);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

// parseListen splits a listen address into its host and port. Node's listen
// takes a port and a host, not an "host:port" string, which it would treat
// as a named pipe.
export function parseListen(listen: string): { host: string; port: number } {
  const index = listen.lastIndexOf(":");
  if (index === -1) {
    return { host: "127.0.0.1", port: 8080 };
  }
  const host = listen.slice(0, index) || "127.0.0.1";
  const port = Number(listen.slice(index + 1));
  return { host, port: Number.isFinite(port) ? port : 8080 };
}
