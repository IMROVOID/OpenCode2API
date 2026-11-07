import { BUILTIN_FREE_MODELS } from "../unlimited/index.js";
import { getWorkerGuard } from "./unlimited.js";

export const SESSION_COOKIE = "opencode_admin_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface AdminSession {
  readonly username: string;
  readonly csrf: string;
  readonly expires: number;
}

const sessions = new Map<string, AdminSession>();

function randomToken(len = 24): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

function constantTimeStringEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) {
    return cookies;
  }
  for (const part of cookieHeader.split(";")) {
    const [rawKey = "", rawVal = ""] = part.trim().split("=");
    if (rawKey) {
      cookies[rawKey.trim()] = decodeURIComponent(rawVal.trim());
    }
  }
  return cookies;
}

export function getValidSession(request: Request): AdminSession | undefined {
  const cookieHeader = request.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  const token =
    cookies[SESSION_COOKIE] ??
    request.headers.get("x-admin-token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return undefined;
  }
  const session = sessions.get(token);
  if (!session) {
    return undefined;
  }
  if (Date.now() > session.expires) {
    sessions.delete(token);
    return undefined;
  }
  return session;
}

export async function handleAdminLogin(
  request: Request,
  env: Record<string, string | undefined>,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResp({ error: { message: "Invalid JSON body" } }, 400, corsHeaders);
  }
  const expectedUser = env.ADMIN_USERNAME ?? "admin";
  const expectedPass = env.ADMIN_PASSWORD ?? env.WEBUI_PASSWORD ?? "admin";

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (
    !constantTimeStringEquals(username, expectedUser) ||
    !constantTimeStringEquals(password, expectedPass)
  ) {
    return jsonResp(
      { error: { message: "Invalid username or password" } },
      401,
      corsHeaders,
    );
  }

  const token = randomToken(32);
  const csrf = randomToken(16);
  sessions.set(token, {
    username,
    csrf,
    expires: Date.now() + SESSION_TTL_MS,
  });

  const headers = new Headers(corsHeaders);
  headers.set(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
  );
  headers.set("Content-Type", "application/json");
  return new Response(
    JSON.stringify({ success: true, username, csrf_token: csrf }) + "\n",
    { status: 200, headers },
  );
}

export function handleAdminSession(
  request: Request,
  corsHeaders: Record<string, string>,
): Response {
  const session = getValidSession(request);
  if (!session) {
    return jsonResp(
      { error: { message: "Session invalid or expired" } },
      401,
      corsHeaders,
    );
  }
  return jsonResp(
    {
      username: session.username,
      csrf_token: session.csrf,
      ttl: Math.max(0, Math.floor((session.expires - Date.now()) / 1000)),
    },
    200,
    corsHeaders,
  );
}

export function handleAdminLogout(
  request: Request,
  corsHeaders: Record<string, string>,
): Response {
  const cookieHeader = request.headers.get("cookie");
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (token) {
    sessions.delete(token);
  }
  const headers = new Headers(corsHeaders);
  headers.set("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ success: true }) + "\n", {
    status: 200,
    headers,
  });
}

export function handleAdminMonitor(
  env: Record<string, string | undefined>,
  corsHeaders: Record<string, string>,
): Response {
  const guard = getWorkerGuard();
  const snap = guard.snapshot();
  const overview = {
    metrics: {
      lifetime: { total: 0, errors: 0, success_rate: 1.0 },
      last_hour: { total: 0 },
      usage: {
        lifetime: {
          tokens: { input_tokens: 0, output_tokens: 0 },
        },
      },
      upstream: {
        lifetime: { total: snap.hops },
        requests: [
          {
            time: new Date().toISOString(),
            model: "beam-free",
            tier: "zen",
            status: 200,
            duration_ms: 15,
            outcome: "success",
          },
        ],
      },
      active_requests: 0,
      active_streams: 0,
      uptime_seconds: Math.floor(Date.now() / 1000) - (snap.lastHop || 0),
      series: [],
      models: {
        "beam-free": 1,
        "deepseek-v4.1-flash-free": 1,
      },
    },
    worker: {
      runtime: "cloudflare-worker",
      current_edge: snap.currentEdge,
      prefix64: snap.currentPrefix64,
      total_hops: snap.hops,
      blacklisted_blocks: snap.blacklist.length,
      upstream_zen: env.UPSTREAM_ZEN ?? "https://opencode.ai/zen",
      upstream_anonymous: env.UPSTREAM_ANONYMOUS ?? "https://opencode.ai/inference",
      upstream_kilo: env.UPSTREAM_KILO ?? "https://api.kilo.ai/api/gateway",
    },
  };
  return jsonResp(overview, 200, corsHeaders);
}

export function handleAdminModels(
  corsHeaders: Record<string, string>,
): Response {
  const list = BUILTIN_FREE_MODELS.map((id) => ({
    id,
    tier: id.includes("/") ? "kilo" : "zen",
    protocol: "chat",
    anonymous: true,
  }));
  return jsonResp(
    {
      catalog: {
        total: list.length,
        exposed: list.length,
        stale: false,
      },
      models: list,
    },
    200,
    corsHeaders,
  );
}

export function handleAdminConfig(
  env: Record<string, string | undefined>,
  corsHeaders: Record<string, string>,
): Response {
  return jsonResp(
    {
      runtime: "cloudflare-worker",
      listen: "edge",
      webui: {
        enabled: (env.WEBUI_ENABLED ?? "true").toLowerCase() !== "false",
        path: env.WEBUI_PATH ?? env.ADMIN_PATH ?? "/",
        username: env.ADMIN_USERNAME ?? "admin",
      },
      models: {
        free_only: true,
        count: BUILTIN_FREE_MODELS.length,
      },
      upstream: {
        zen: env.UPSTREAM_ZEN ?? "https://opencode.ai/zen",
        go: env.UPSTREAM_GO ?? "https://opencode.ai/zen/go",
        anonymous: env.UPSTREAM_ANONYMOUS ?? "https://opencode.ai/inference",
        kilo: env.UPSTREAM_KILO ?? "https://api.kilo.ai/api/gateway",
      },
    },
    200,
    corsHeaders,
  );
}

function jsonResp(data: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(data) + "\n", {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
