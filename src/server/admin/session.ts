import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Config } from "../../types/config.js";
import { fingerprintSecret, maskSecret } from "../../config/secrets.js";

// The name of the session cookie.
export const SESSION_COOKIE = "opencode2api_session";

// The number of minutes a session stays valid.
export const DEFAULT_SESSION_TTL_MINUTES = 720;

// The maximum number of sessions the store holds.
const MAX_SESSIONS = 2048;

// The length of the session token and the CSRF token, in bytes.
const SESSION_TOKEN_BYTES = 32;
const CSRF_TOKEN_BYTES = 24;

// The session record.
export interface AdminSession {
  username: string;
  authVersion: string;
  csrf: string;
  expires: number;
}

// SessionStore holds the admin sessions. The raw token is never stored, only
// its digest.
export class SessionStore {
  private readonly sessions = new Map<string, AdminSession>();

  // create issues a new session and returns its token and CSRF token.
  create(username: string, authVersion: string, ttlMinutes: number): {
    token: string;
    csrf: string;
  } {
    if (this.sessions.size >= MAX_SESSIONS) {
      this.evictOldest();
    }
    const token = randomToken(SESSION_TOKEN_BYTES);
    const csrf = randomToken(CSRF_TOKEN_BYTES);
    const expires = Date.now() + ttlMinutes * 60_000;
    this.sessions.set(digest(token), {
      username,
      authVersion,
      csrf,
      expires,
    });
    return { token, csrf };
  }

  // get returns the session a token belongs to, or undefined when it is
  // unknown or expired.
  get(token: string): AdminSession | undefined {
    if (token === "") {
      return undefined;
    }
    const key = digest(token);
    const session = this.sessions.get(key);
    if (session === undefined) {
      return undefined;
    }
    if (session.expires <= Date.now()) {
      this.sessions.delete(key);
      return undefined;
    }
    return session;
  }

  // drop removes a session.
  drop(token: string): void {
    this.sessions.delete(digest(token));
  }

  // dropAll removes every session, which a password change forces.
  dropAll(): void {
    this.sessions.clear();
  }

  // count reports how many sessions the store holds.
  count(): number {
    return this.sessions.size;
  }

  // evictOldest removes the session that expires first.
  private evictOldest(): void {
    let oldestKey = "";
    let oldest = Number.POSITIVE_INFINITY;
    for (const [key, session] of this.sessions) {
      if (session.expires < oldest) {
        oldest = session.expires;
        oldestKey = key;
      }
    }
    if (oldestKey !== "") {
      this.sessions.delete(oldestKey);
    }
  }
}

// randomToken returns a base64url token of the requested byte length.
export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

// digest returns the hex SHA-256 of a token.
export function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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

// authVersionOf returns the version a session's credentials carry. Changing
// the password changes the version and invalidates every session.
export function authVersionOf(config: Config): string {
  return fingerprintSecret(config.webui.password_hash ?? config.webui.password ?? "");
}

// maskSecretValue masks a secret for display.
export function maskSecretValue(value: string): string {
  return maskSecret(value);
}
