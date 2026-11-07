import type { Protocol } from "../types/config.js";
import type { RequestIDs } from "../protocol/identity.js";
import { isV1Upstream } from "../protocol/lanes.js";
import { buildUpstreamRequest } from "../protocol/upstream-request.js";
import { prepareAnonymousBody } from "../protocol/tools.js";
import { V1_BASE } from "../config/defaults.js";
import type { Logger } from "../telemetry/logger.js";
import type { Metrics } from "../telemetry/metrics.js";
import type { UpstreamAttemptRecord } from "../types/inference.js";
import { keyDisplayId } from "../config/secrets.js";
import { buildEdgeFetchInit } from "../unlimited/lane.js";
import { KILO_ANONYMOUS_TOKEN, KILO_GATEWAY_BASE } from "../unlimited/kilo.js";
import {
  type UpstreamResponse,
} from "./upstream-client.js";

// AttemptOutcome is the result of one upstream attempt.
export interface AttemptOutcome {
  response: UpstreamResponse | undefined;
  error: Error | undefined;
  attempts: number;
  records: UpstreamAttemptRecord[];
  // alias is the tool name the v1 lane aliased, which the response restores.
  alias: string;
  // shaped reports whether the body was force streamed upstream, so the
  // gateway collapses the events back for a non-streaming client.
  shaped: boolean;
}

// AttemptPools are the key pools of the two tiers.
export interface AttemptPools {
  zen: KeyPoolLike;
  go: KeyPoolLike;
}

// KeyPoolLike is the part of the key pool the runner uses.
export interface KeyPoolLike {
  isEmpty(): boolean;
  cursorFor(affinity: string): KeyCursorLike;
  markSuccess(node: KeyNodeLike): void;
  markFailure(
    node: KeyNodeLike,
    status: number,
    retryAfter: number,
    cooldownSeconds: number,
  ): void;
}

// KeyNodeLike is the part of a key node the runner uses.
export interface KeyNodeLike {
  key: string;
  failures: number;
  cooldownUntil: number;
}

// KeyCursorLike is the part of a key cursor the runner uses.
export interface KeyCursorLike {
  next(): KeyNodeLike | undefined;
}

// The upstream base URLs of the two tiers and the anonymous lane.
export interface UpstreamLanes {
  zen: string;
  go: string;
  anonymous: string;
}

// sendRequest performs one upstream request and returns the response.
export async function sendRequest(
  baseURL: string,
  protocol: Protocol,
  body: string,
  ids: RequestIDs,
  key: string,
  timeoutSeconds: number,
  edge = "",
): Promise<UpstreamResponse> {
  const request = buildUpstreamRequest(baseURL, protocol, body, ids, key);
  const controller = new AbortController();
  const timer = setTimeout(
    () => {
      controller.abort();
    },
    timeoutSeconds * 1000,
  );
  try {
    const init = buildEdgeFetchInit(
      {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      },
      edge,
    );
    const response = await fetch(request.url, init);
    return {
      status: response.status,
      headers: response.headers,
      stream: response.body as unknown as AsyncIterable<Uint8Array>,
    };
  } finally {
    clearTimeout(timer);
  }
}

// shapeBody applies the upstream gate's request shaping to a body. The v1 lane
// needs a read tool and the v2 lane the core tools.
export function shapeBody(
  body: string,
  protocol: Protocol,
  baseURL: string,
): { body: string; alias: string; shaped: boolean } {
  return prepareAnonymousBody(body, protocol, isV1Upstream(baseURL));
}

// anonymousUpstreams lists the lanes the anonymous phase tries, in order. The
// v2 /inference lane comes first, followed by the v1 /zen lane.
export function anonymousUpstreams(lanes: UpstreamLanes): string[] {
  const v1 = V1_BASE.replace(/\/+$/, "");
  const primary = lanes.anonymous.replace(/\/+$/, "");
  if (primary === "" || primary.toLowerCase() === v1.toLowerCase()) {
    return [v1];
  }
  return [primary, v1];
}

// outcomeFor classifies the result of one attempt.
export function outcomeFor(status: number, error: Error | undefined): string {
  if (error !== undefined) {
    return "transport_error";
  }
  if (status >= 200 && status < 300) {
    return "success";
  }
  if (status === 401 || status === 403) {
    return "rejected";
  }
  if (status === 429) {
    return "quota_or_rate_limit";
  }
  if (status >= 500) {
    return "upstream_error";
  }
  return "request_error";
}

// parseRetryAfterHeader reads the Retry-After header of a response.
export function parseRetryAfterHeader(headers: Headers | undefined): number {
  if (headers === undefined) {
    return 0;
  }
  const value = headers.get("retry-after");
  if (value === null) {
    return 0;
  }
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  const when = Date.parse(value);
  if (Number.isNaN(when)) {
    return 0;
  }
  return Math.max(when - Date.now(), 0);
}

// keyDisplayOf returns the display id of a key.
export function keyDisplayOf(key: string): string {
  return keyDisplayId(key);
}

// buildAttemptRecord builds and records one UpstreamAttemptRecord.
export function buildAttemptRecord(
  metrics: Metrics,
  params: {
    requestID: string;
    model: string;
    tier: "zen" | "go";
    attempt: number;
    keyID: string;
    channel: "key" | "anonymous";
    anonymous: boolean;
    proxyNode?: string;
    status: number;
    durationMs: number;
    error: Error | undefined;
  },
): UpstreamAttemptRecord {
  const success =
    params.error === undefined && params.status >= 200 && params.status < 300;
  const record: UpstreamAttemptRecord = {
    time: new Date().toISOString(),
    request_id: params.requestID,
    model: params.model,
    tier: params.tier,
    attempt: params.attempt,
    key_id: params.keyID,
    channel: params.channel,
    anonymous: params.anonymous,
    proxy_node: params.proxyNode ?? "",
    status: params.status,
    duration_ms: params.durationMs,
    success,
    outcome: success ? "success" : outcomeFor(params.status, params.error),
  };
  metrics.recordAttempt({ ...record });
  return record;
}

// attemptKiloAnonymous performs one keyless attempt against the Kilo Free Gateway.
export async function attemptKiloAnonymous(
  metrics: Metrics,
  timeoutSeconds: number,
  body: string,
  ids: RequestIDs,
  requestID: string,
  model: string,
  kiloModel: string,
): Promise<AttemptOutcome> {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      payload = { ...(parsed as Record<string, unknown>), model: kiloModel, stream: true };
    }
  } catch {
    // Keep original body if invalid JSON.
  }
  const kiloBody = Object.keys(payload).length > 0 ? JSON.stringify(payload) : body;
  const started = Date.now();
  let response: UpstreamResponse | undefined;
  let error: Error | undefined;
  try {
    response = await sendRequest(
      KILO_GATEWAY_BASE,
      "chat",
      kiloBody,
      ids,
      KILO_ANONYMOUS_TOKEN,
      timeoutSeconds,
      "",
    );
  } catch (caught) {
    error = caught instanceof Error ? caught : new Error(String(caught));
  }
  const durationMs = Date.now() - started;
  const status = response?.status ?? 0;
  const record = buildAttemptRecord(metrics, {
    requestID,
    model,
    tier: "zen",
    attempt: 1,
    keyID: "kilo-anonymous",
    channel: "anonymous",
    anonymous: true,
    proxyNode: "kilo",
    status,
    durationMs,
    error,
  });
  return {
    response,
    error,
    attempts: 1,
    records: [record],
    alias: "",
    shaped: true,
  };
}

export type { Logger, Metrics, UpstreamAttemptRecord };
