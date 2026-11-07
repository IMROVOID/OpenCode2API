import type { Protocol } from "../types/config.js";
import type { RequestIDs } from "../protocol/identity.js";
import { boolAt } from "../protocol/json-util.js";
import { isV1Upstream } from "../protocol/lanes.js";
import { prepareAnonymousBody } from "../protocol/tools.js";
import { buildUpstreamRequest } from "../protocol/upstream-request.js";
import {
  DEFAULT_AAAA_POOL,
  KILO_ANONYMOUS_TOKEN,
  KILO_GATEWAY_BASE,
  UnlimitedGuard,
  buildDoctorReport,
  buildEdgeFetchInit,
  buildKiloUpstreamRequest,
  isKiloModelId,
  isQuotaWall,
  kiloFallbackChain,
  normalizeUnlimitedResponse,
  resolveEdgePool,
  resolveOpenCodeFreeModel,
  type DoctorReport,
} from "../unlimited/index.js";

const DEFAULT_ZEN = "https://opencode.ai/zen";
const DEFAULT_GO = "https://opencode.ai/zen/go";
const DEFAULT_ANONYMOUS = "https://opencode.ai/inference";
const ANONYMOUS_TOKEN = "public";

export interface WorkerUnlimitedEnv {
  OPENCODE_ZEN_KEYS?: string;
  OPENCODE_GO_KEYS?: string;
  UPSTREAM_ZEN?: string;
  UPSTREAM_GO?: string;
  UPSTREAM_ANONYMOUS?: string;
  UPSTREAM_KILO?: string;
}

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

export interface UpstreamCandidate {
  readonly kind: "opencode" | "kilo";
  readonly baseURL: string;
  readonly key: string;
  readonly modelOverride?: string | undefined;
}

let workerGuardInstance: UnlimitedGuard | undefined;

export function getWorkerGuard(): UnlimitedGuard {
  if (workerGuardInstance === undefined) {
    workerGuardInstance = new UnlimitedGuard(DEFAULT_AAAA_POOL, "worker");
  }
  return workerGuardInstance;
}

export async function handleWorkerDoctor(
  fetchImpl: typeof fetch = fetch,
): Promise<DoctorReport> {
  const guard = getWorkerGuard();
  const pool = await resolveEdgePool(fetchImpl);
  guard.setPool(pool);
  return buildDoctorReport(guard, fetchImpl, "cloudflare-worker");
}

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

// collectCandidates builds the ordered list of upstream targets: configured Go
// keys, Zen keys, OpenCode v2 anonymous lane, and Kilo Free Gateway failover.
export function collectCandidates(
  env: WorkerUnlimitedEnv,
  requestedModel = "",
): UpstreamCandidate[] {
  const goKeys = parseKeys(env.OPENCODE_GO_KEYS);
  const zenKeys = parseKeys(env.OPENCODE_ZEN_KEYS);
  const goBase = env.UPSTREAM_GO ?? DEFAULT_GO;
  const zenBase = env.UPSTREAM_ZEN ?? DEFAULT_ZEN;
  const anonBase = env.UPSTREAM_ANONYMOUS ?? DEFAULT_ANONYMOUS;
  const kiloBase = env.UPSTREAM_KILO ?? KILO_GATEWAY_BASE;
  const candidates: UpstreamCandidate[] = [];

  for (const key of goKeys) {
    candidates.push({ kind: "opencode", baseURL: goBase, key });
  }
  for (const key of zenKeys) {
    candidates.push({ kind: "opencode", baseURL: zenBase, key });
  }

  const ocModel =
    requestedModel !== "" ? resolveOpenCodeFreeModel(requestedModel) : undefined;
  const kiloModels = kiloFallbackChain(requestedModel || "beam-free");

  if (requestedModel !== "" && isKiloModelId(requestedModel)) {
    for (const kiloModel of kiloModels) {
      candidates.push({
        kind: "kilo",
        baseURL: kiloBase,
        key: KILO_ANONYMOUS_TOKEN,
        modelOverride: kiloModel,
      });
    }
  }

  candidates.push({
    kind: "opencode",
    baseURL: anonBase,
    key: ANONYMOUS_TOKEN,
    modelOverride: ocModel,
  });

  for (const kiloModel of kiloModels) {
    candidates.push({
      kind: "kilo",
      baseURL: kiloBase,
      key: KILO_ANONYMOUS_TOKEN,
      modelOverride: kiloModel,
    });
  }

  if (
    anonBase.replace(/\/+$/, "").toLowerCase() !==
    zenBase.replace(/\/+$/, "").toLowerCase()
  ) {
    candidates.push({
      kind: "opencode",
      baseURL: zenBase,
      key: ANONYMOUS_TOKEN,
      modelOverride: ocModel,
    });
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
// self-healing guard, rotating across OpenCode v2 and Kilo Free lanes on 429.
export async function forwardWithUnlimitedGuard(
  env: WorkerUnlimitedEnv,
  protocol: Protocol,
  payload: Record<string, unknown>,
  initialIDs: RequestIDs,
  corsHeaders: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const guard = getWorkerGuard();
  const requestedModel =
    typeof payload["model"] === "string" ? payload["model"] : "beam-free";
  const clientWantsStream = boolAt(payload, "stream") === true;
  const candidates = collectCandidates(env, requestedModel);

  const guarded = await guard.executeWithGuard(async (lane, attempt) => {
    const activeIDs = attempt === 1 ? initialIDs : lane.ids;
    const candidate = candidates[(attempt - 1) % candidates.length] ?? {
      kind: "opencode" as const,
      baseURL: DEFAULT_ANONYMOUS,
      key: ANONYMOUS_TOKEN,
    };

    const { request, upstreamProtocol, alias } = prepareCandidateRequest(
      candidate,
      protocol,
      payload,
      activeIDs,
      clientWantsStream,
    );
    const init =
      candidate.kind === "opencode"
        ? buildEdgeFetchInit(
            { method: "POST", headers: request.headers, body: request.body },
            lane.edge,
          )
        : { method: "POST", headers: request.headers, body: request.body };

    const response = await fetchImpl(request.url, init);
    if (response.status >= 200 && response.status < 300) {
      const normalized = await normalizeUnlimitedResponse(
        response,
        upstreamProtocol,
        protocol,
        requestedModel,
        alias,
        clientWantsStream,
      );
      return {
        status: normalized.status,
        bodyPreview: "",
        value: { response: normalized, ids: activeIDs, edge: lane.edge },
      };
    }
    const errorText = await response.text();
    const shouldRotate =
      isQuotaWall(response.status, errorText) ||
      (candidate.key === ANONYMOUS_TOKEN &&
        (response.status === 400 ||
          response.status === 401 ||
          response.status === 403 ||
          response.status === 404));
    const rebuilt = new Response(errorText, {
      status: response.status,
      headers: response.headers,
    });
    return {
      status: shouldRotate ? 429 : response.status,
      bodyPreview: shouldRotate ? errorText || "QuotaExceeded" : errorText,
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

function prepareCandidateRequest(
  candidate: UpstreamCandidate,
  protocol: Protocol,
  payload: Record<string, unknown>,
  ids: RequestIDs,
  clientWantsStream: boolean,
): {
  request: ReturnType<typeof buildUpstreamRequest>;
  upstreamProtocol: Protocol;
  alias: string;
} {
  if (candidate.kind === "kilo") {
    const kiloModel = candidate.modelOverride ?? "reflection/beam-free";
    return {
      request: buildKiloUpstreamRequest(
        kiloModel,
        protocol,
        payload,
        clientWantsStream,
        candidate.baseURL,
      ),
      upstreamProtocol: "chat",
      alias: "",
    };
  }
  const effectivePayload =
    candidate.modelOverride !== undefined && candidate.key === ANONYMOUS_TOKEN
      ? { ...payload, model: candidate.modelOverride }
      : payload;
  const rawBody = JSON.stringify(effectivePayload);
  const shaped = prepareAnonymousBody(
    rawBody,
    protocol,
    isV1Upstream(candidate.baseURL),
  );
  return {
    request: buildUpstreamRequest(
      candidate.baseURL,
      protocol,
      shaped.body,
      ids,
      candidate.key,
    ),
    upstreamProtocol: protocol,
    alias: shaped.alias,
  };
}
