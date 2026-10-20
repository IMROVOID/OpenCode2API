import type { Protocol, Tier } from "../types/config.js";
import type { RequestIDs } from "../protocol/identity.js";
import { buildUpstreamRequest } from "../protocol/upstream-request.js";
import { tierBaseURL } from "../protocol/lanes.js";

// The anonymous credential is the literal token "public".
export const ANONYMOUS_CREDENTIAL = "public";

// UpstreamResponse is the response of one upstream attempt.
export interface UpstreamResponse {
  status: number;
  headers: Headers;
  stream: AsyncIterable<Uint8Array>;
}

// UpstreamAttempt is one attempt at one key of one tier.
export interface UpstreamAttempt {
  tier: Tier;
  key: string;
  keyId: string;
  status: number;
  error: Error | undefined;
  durationMs: number;
}

// UpstreamClient sends the requests to the upstream lanes.
export class UpstreamClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutSeconds = 300,
  ) {}

  // send performs one attempt and returns the response. A non-2xx response is
  // returned as it is, so the caller can decide whether to rotate the key.
  async send(
    baseURL: string,
    protocol: Protocol,
    body: string,
    ids: RequestIDs,
    key: string,
  ): Promise<UpstreamResponse> {
    const request = buildUpstreamRequest(baseURL, protocol, body, ids, key);
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        controller.abort();
      },
      this.timeoutSeconds * 1000,
    );
    try {
      const response = await this.fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      return {
        status: response.status,
        headers: response.headers,
        stream: streamOf(response),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

// streamOf turns a fetch response into a byte stream.
function streamOf(response: Response): AsyncIterable<Uint8Array> {
  const body = response.body;
  if (body === null) {
    return emptyStream();
  }
  return body as unknown as AsyncIterable<Uint8Array>;
}

// emptyStream is a stream with no bytes.
function emptyStream(): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      return undefined;
    },
  };
}

// upstreamBaseURL returns the base URL of a tier.
export function upstreamBaseURL(
  upstream: { zen: string; go: string; anonymous: string },
  tier: Tier,
  anonymous: boolean,
): string {
  if (anonymous) {
    return upstream.anonymous;
  }
  return tierBaseURL(upstream, tier);
}
