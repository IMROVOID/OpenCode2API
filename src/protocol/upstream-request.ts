import type { Protocol } from "../types/config.js";
import type { RequestIDs } from "./identity.js";
import { isV1Upstream, upstreamURL } from "./lanes.js";
import { setV1Headers, setV2Headers } from "./upstream-headers.js";

// UpstreamRequest is one request the proxy sends to an upstream lane.
export interface UpstreamRequest {
  url: string;
  headers: Headers;
  body: string;
}

// buildUpstreamRequest builds the request for one upstream lane. The v1 lane
// sends the OpenCode 1.x header set, the v2 lane the 2.x one, and the
// credential is sent the way the target protocol expects it.
export function buildUpstreamRequest(
  baseURL: string,
  protocol: Protocol,
  body: string,
  ids: RequestIDs,
  key: string,
): UpstreamRequest {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  if (isV1Upstream(baseURL)) {
    setV1Headers(headers, protocol, body, ids);
  } else {
    setV2Headers(headers, protocol, ids);
  }
  if (protocol === "anthropic") {
    headers.set("x-api-key", key);
    headers.set("anthropic-version", "2023-06-01");
  } else {
    // The anonymous credential is the literal token "public". The 2026-10-14
    // gate rejects keyless requests (an absent header used to pass) and is
    // case-sensitive: "Bearer PUBLIC" 401s.
    headers.set("Authorization", `Bearer ${key}`);
  }
  return { url: upstreamURL(baseURL, protocol), headers, body };
}

// isNonRetryableClientResponse reports whether a response is a 4xx that
// retrying on another key of the same tier cannot fix: every 4xx except 401,
// 403 and 429, which can be specific to the key. A transport error is never
// non-retryable.
export function isNonRetryableClientResponse(status: number): boolean {
  return (
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 403 &&
    status !== 429
  );
}

// isRotatableStatus reports whether a status makes the request worth
// retrying on another key of the same tier.
export function isRotatableStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}
