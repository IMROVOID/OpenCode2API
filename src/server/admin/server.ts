import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { Config } from "../../types/config.js";
import type { Gateway } from "../gateway.js";
import { WEBUI_HTML } from "../../webui/document.js";
import {
  SESSION_COOKIE,
  SessionStore,
  authVersionOf,
} from "./session.js";
import { handleAdminRequest } from "./routes.js";
import { writeAdminError } from "./responses.js";

// The security headers every response carries.
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

// The scrypt parameters the password hash uses.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_SALT_LENGTH = 16;

// hashPassword derives a storable hash from a password.
export function hashPassword(password: string): string {
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "$scrypt",
    `N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}`,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}
// verifyPassword checks a password against a storable hash.
export function verifyPassword(hash: string, password: string): boolean {
  const parts = hash.split("$");
  // The format is "$scrypt$N=..,r=..,p=..$<salt>$<hash>", so the split
  // yields an empty first part and four more.
  if (parts.length !== 5 || parts[1] !== "scrypt") {
    return false;
  }
  const params = parts[2] ?? "";
  const N = paramValue(params, "N");
  const r = paramValue(params, "r");
  const p = paramValue(params, "p");
  if (N === 0 || r === 0 || p === 0) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[3] ?? "", "base64");
    expected = Buffer.from(parts[4] ?? "", "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  let derived: Buffer;
  try {
    derived = scryptSync(password, salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) {
    return false;
  }
  return constantTimeEquals(derived.toString("base64"), expected.toString("base64"));
}

// paramValue reads one parameter of a hash's parameter list.
function paramValue(params: string, name: string): number {
  for (const part of params.split(",")) {
    const [key, value] = part.split("=");
    if (key === name) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
  }
  return 0;
}

// constantTimeEquals compares two secrets without leaking their length.
export function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

// WebUIServer serves the control panel and the admin API.
export class WebUIServer {
  readonly sessions = new SessionStore();
  readonly gateway: Gateway;

  constructor(gateway: Gateway, private readonly config: Config) {
    this.gateway = gateway;
  }

  // handle serves one request.
  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.setHeader(name, value);
    }
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    if (url.pathname.startsWith("/api/")) {
      await handleAdminRequest(this, request, response, url);
      return;
    }
    this.serveDocument(response);
  }

  // serveDocument answers with the WebUI.
  private serveDocument(response: ServerResponse): void {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(WEBUI_HTML),
    });
    response.end(WEBUI_HTML);
  }

  // currentConfig returns the running configuration.
  currentConfig(): Config {
    return this.config;
  }

  // sessionCookie builds the cookie that carries a session token.
  sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
    const parts = [
      `${SESSION_COOKIE}=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${maxAgeSeconds}`,
    ];
    if (secure) {
      parts.push("Secure");
    }
    return parts.join("; ");
  }

  // clearCookie builds the cookie that ends a session.
  clearCookie(secure: boolean): string {
    return this.sessionCookie("", -1, secure);
  }

  // tokenFrom reads the session token from a request's cookies.
  tokenFrom(request: IncomingMessage): string {
    const header = request.headers.cookie;
    if (typeof header !== "string") {
      return "";
    }
    for (const part of header.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === SESSION_COOKIE) {
        return rest.join("=");
      }
    }
    return "";
  }

  // isSecure reports whether the request arrived over TLS.
  isSecure(request: IncomingMessage): boolean {
    const forwarded = request.headers["x-forwarded-proto"];
    if (
      typeof forwarded === "string" &&
      forwarded.trim().toLowerCase() === "https"
    ) {
      return true;
    }
    return (request.socket as { encrypted?: boolean }).encrypted === true;
  }

  // validSession returns the session a request carries, or undefined.
  validSession(request: IncomingMessage): ReturnType<SessionStore["get"]> {
    const token = this.tokenFrom(request);
    const session = this.sessions.get(token);
    if (session === undefined) {
      return undefined;
    }
    if (session.username !== this.config.webui.username) {
      return undefined;
    }
    if (session.authVersion !== authVersionOf(this.config)) {
      return undefined;
    }
    return session;
  }

  // checkCredentials reports whether a username and password match.
  checkCredentials(username: string, password: string): boolean {
    if (username !== this.config.webui.username) {
      return false;
    }
    const hash = this.config.webui.password_hash ?? "";
    if (hash !== "") {
      return verifyPassword(hash, password);
    }
    return constantTimeEquals(this.config.webui.password ?? "", password);
  }
}

// startWebUIServer starts the control panel server.
export async function startWebUIServer(
  gateway: Gateway,
  listen: string,
): Promise<Server> {
  const server = new WebUIServer(gateway, gateway.current());
  const http = createServer((request, response) => {
    void server.handle(request, response).catch(() => {
      if (!response.headersSent) {
        writeAdminError(response, 500, "internal_error", "internal error");
      }
    });
  });
  return new Promise((resolve, reject) => {
    http.once("error", reject);
    const { host, port } = parseListen(listen);
    http.listen(port, host, () => {
      http.removeListener("error", reject);
      resolve(http);
    });
  });
}

// parseListen splits a listen address into its host and port.
function parseListen(listen: string): { host: string; port: number } {
  const index = listen.lastIndexOf(":");
  if (index === -1) {
    return { host: "127.0.0.1", port: 8081 };
  }
  const host = listen.slice(0, index) || "127.0.0.1";
  const port = Number(listen.slice(index + 1));
  return { host, port: Number.isFinite(port) ? port : 8081 };
}
