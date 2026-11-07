import type { Protocol } from "../types/config.js";
import type { RequestIDs } from "../protocol/identity.js";
import { isV1Upstream } from "../protocol/lanes.js";
import { prepareAnonymousBody } from "../protocol/tools.js";
import { buildUpstreamRequest } from "../protocol/upstream-request.js";
import {
  DEFAULT_AAAA_POOL,
  UnlimitedGuard,
  buildDoctorReport,
  buildEdgeFetchInit,
  isQuotaWall,
  resolveEdgePool,
  type DoctorReport,
} from "../unlimited/index.js";

const DEFAULT_ZEN = "https://opencode.ai/zen";
const DEFAULT_GO = "https://opencode.ai/zen/go";
const DEFAULT_ANONYMOUS = "https://opencode.ai/inference";
const ANONYMOUS_TOKEN = "public";

// WorkerUnlimitedEnv is the subset of Worker environment variables used by the
// unlimited lane and guard.
export interface WorkerUnlimitedEnv {
  OPENCODE_ZEN_KEYS?: string;
  OPENCODE_GO_KEYS?: string;
  UPSTREAM_ZEN?: string;
  UPSTREAM_GO?: string;
  UPSTREAM_ANONYMOUS?: string;
}

// HopResponse is returned by POST /v1/unlimited/hop.
export interface HopResponse {
  readonly status: "rotated";
  readonly old_edge: string;
  readonly new_edge: string;
  readonly prefix64: string;
  readonly session: string;
  readonly machine_id: string;
  readonly hops: number;
  readonly blacklisted_count: number;
}

// Lazily initialized Worker-scoped guard instance (never constructed in global scope).
let workerGuardInstance: UnlimitedGuard | undefined;

export function getWorkerGuard(): UnlimitedGuard {
  if (workerGuardInstance === undefined) {
    workerGuardInstance = new UnlimitedGuard(DEFAULT_AAAA_POOL, "worker");
  }
  return workerGuardInstance;
}

// handleWorkerDoctor returns the DoctorReport for the Cloudflare Worker.
export async function handleWorkerDoctor(
  fetchImpl: typeof fetch = fetch,
): Promise<DoctorReport> {
  const guard = getWorkerGuard();
  const pool = await resolveEdgePool(fetchImpl);
  guard.setPool(pool);
  return buildDoctorReport(guard, fetchImpl, "cloudflare-worker");
}

// handleWorkerHop rotates the active Worker edge and identity immediately.
export async function handleWorkerHop(
  fetchImpl: typeof fetch = fetch,
): Promise<HopResponse> {
  const guard = getWorkerGuard();
  const oldEdge = guard.current().edge;
  const pool = await resolveEdgePool(fetchImpl);
  guard.setPool(pool);
  const rotated = guard.hop(pool, true);
  const snap = guard.snapshot();
  return {
    status: "rotated",
    old_edge: oldEdge,
    new_edge: rotated.edge,
    prefix64: rotated.prefix64,
    session: rotated.ids.session,
    machine_id: rotated.machineId,
    hops: snap.hops,
    blacklisted_count: snap.blacklist.length,
  };
}

interface UpstreamCandidate {
  readonly baseURL: string;
  readonly key: string;
}

// collectCandidates builds the ordered list of upstream targets (configured Go
// keys, Zen keys, then anonymous v1/v2 lanes).
export function collectCandidates(env: WorkerUnlimitedEnv): UpstreamCandidate[] {
  const goKeys = parseKeys(env.OPENCODE_GO_KEYS);
  const zenKeys = parseKeys(env.OPENCODE_ZEN_KEYS);
  const goBase = env.UPSTREAM_GO ?? DEFAULT_GO;
  const zenBase = env.UPSTREAM_ZEN ?? DEFAULT_ZEN;
  const anonBase = env.UPSTREAM_ANONYMOUS ?? DEFAULT_ANONYMOUS;
  const candidates: UpstreamCandidate[] = [];
  for (const key of goKeys) {
    candidates.push({ baseURL: goBase, key });
  }
  for (const key of zenKeys) {
    candidates.push({ baseURL: zenBase, key });
  }
  // Always include anonymous lanes as fallback (or primary when keyless).
  candidates.push({ baseURL: zenBase, key: ANONYMOUS_TOKEN });
  if (anonBase.replace(/\/+$/, "").toLowerCase() !== zenBase.replace(/\/+$/, "").toLowerCase()) {
    candidates.push({ baseURL: anonBase, key: ANONYMOUS_TOKEN });
  }
  return candidates;
}

function parseKeys(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

// forwardWithUnlimitedGuard sends the completion request through the
// self-healing guard, rotating edges and identities on QuotaExceeded/429.
export async function forwardWithUnlimitedGuard(
  env: WorkerUnlimitedEnv,
  protocol: Protocol,
  payload: Record<string, unknown>,
  initialIDs: RequestIDs,
  corsHeaders: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const guard = getWorkerGuard();
  const candidates = collectCandidates(env);
  const rawBody = JSON.stringify(payload);

  const guarded = await guard.executeWithGuard(async (lane, attempt) => {
    const activeIDs = attempt === 1 ? initialIDs : lane.ids;
    const candidate =
      candidates[(attempt - 1) % candidates.length] ?? {
        baseURL: DEFAULT_ZEN,
        key: ANONYMOUS_TOKEN,
      };
    const shaped = prepareAnonymousBody(
      rawBody,
      protocol,
      isV1Upstream(candidate.baseURL),
    );
    const upstream = buildUpstreamRequest(
      candidate.baseURL,
      protocol,
      shaped.body,
      activeIDs,
      candidate.key,
    );
    upstream.headers.set("x-opencode-machine-id", lane.machineId);
    const init = buildEdgeFetchInit(
      {
        method: "POST",
        headers: upstream.headers,
        body: upstream.body,
      },
      lane.edge,
    );
    const response = await fetchImpl(upstream.url, init);
    if (response.status >= 200 && response.status < 300) {
      return {
        status: response.status,
        bodyPreview: "",
        value: { response, ids: activeIDs, edge: lane.edge },
      };
    }
    const errorText = await response.text();
    const rebuilt = new Response(errorText, {
      status: response.status,
      headers: response.headers,
    });
    return {
      status: response.status,
      bodyPreview: isQuotaWall(response.status, errorText)
        ? errorText || "QuotaExceeded"
        : errorText,
      value: { response: rebuilt, ids: activeIDs, edge: lane.edge },
    };
  });

  const { response, ids, edge } = guarded.value;
  const headers = new Headers(response.headers);
  headers.set("x-request-id", ids.request);
  headers.set("x-opencode-edge", edge);
  headers.set("x-opencode-hops", String(guard.snapshot().hops));
  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}
