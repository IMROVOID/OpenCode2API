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
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
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
// v1 /zen lane comes first, because the two gates accept different request
// shapes.
export function anonymousUpstreams(lanes: UpstreamLanes): string[] {
  const v1 = V1_BASE.replace(/\/+$/, "");
  const primary = lanes.anonymous.replace(/\/+$/, "");
  if (primary === "" || primary.toLowerCase() === v1.toLowerCase()) {
    return [v1];
  }
  return [v1, primary];
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

export type { Logger, Metrics, UpstreamAttemptRecord };
