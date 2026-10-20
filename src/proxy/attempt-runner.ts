import type { Protocol, Tier } from "../types/config.js";
import type { RequestIDs } from "../protocol/identity.js";
import { isNonRetryableClientResponse } from "../protocol/upstream-request.js";
import { tierBaseURL } from "../protocol/lanes.js";
import type { Logger } from "../telemetry/logger.js";
import type { Metrics } from "../telemetry/metrics.js";
import type { UpstreamAttemptRecord } from "../types/inference.js";
import { KeyPool } from "../auth/key-pool.js";
import {
  ANONYMOUS_CREDENTIAL,
  type UpstreamResponse,
} from "./upstream-client.js";
import {
  anonymousUpstreams,
  keyDisplayOf,
  outcomeFor,
  parseRetryAfterHeader,
  sendRequest,
  shapeBody,
  type AttemptOutcome,
} from "./attempt-helpers.js";

// AttemptRunner walks the keys of a tier and returns the first successful
// response. A 401, 403 or 429 rotates to the next key, and any other 4xx is
// returned immediately because retrying it on another key cannot help.
export class AttemptRunner {
  constructor(
    private readonly pools: Record<Tier, KeyPool>,
    private readonly upstream: { zen: string; go: string; anonymous: string },
    private readonly maxAttempts: number,
    private readonly timeoutSeconds: number,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
  ) {}

  // runTier tries the keys of one tier until one of them succeeds.
  async runTier(
    tier: Tier,
    routeProtocol: Protocol,
    body: string,
    ids: RequestIDs,
    requestID: string,
    model: string,
  ): Promise<AttemptOutcome> {
    const pool = this.pools[tier];
    const records: UpstreamAttemptRecord[] = [];
    if (pool.isEmpty()) {
      return {
        response: undefined,
        error: new Error(`no ${tier} nodes configured`),
        attempts: 0,
        records,
        alias: "",
        shaped: false,
      };
    }
    const baseURL = tierBaseURL(this.upstream, tier);
    const cursor = pool.cursorFor(ids.session);
    let attempts = 0;
    let lastResponse: UpstreamResponse | undefined;
    let lastError: Error | undefined;
    // A key tier request is shaped like the anonymous one when the model is
    // free, because the free-tier gate rejects the plain shape.
    const shaped = shapeBody(body, routeProtocol, baseURL);
    const sendBody = shaped.shaped ? shaped.body : body;

    while (attempts < this.maxAttempts) {
      const node = cursor.next();
      if (node === undefined) {
        break;
      }
      attempts += 1;
      const started = Date.now();
      let response: UpstreamResponse | undefined;
      let error: Error | undefined;
      try {
        response = await sendRequest(
          baseURL,
          routeProtocol,
          sendBody,
          ids,
          node.key,
          this.timeoutSeconds,
        );
      } catch (caught) {
        error = caught instanceof Error ? caught : new Error(String(caught));
      }
      const durationMs = Date.now() - started;
      const status = response?.status ?? 0;
      const success = error === undefined && status >= 200 && status < 300;
      const keyID = keyDisplayOf(node.key);
      const record: UpstreamAttemptRecord = {
        time: new Date().toISOString(),
        request_id: requestID,
        model,
        tier,
        attempt: attempts,
        key_id: keyID,
        channel: "key",
        anonymous: false,
        proxy_node: "",
        status,
        duration_ms: durationMs,
        success,
        outcome: success ? "success" : outcomeFor(status, error),
      };
      records.push(record);
      this.metrics.recordAttempt({
        time: record.time,
        request_id: requestID,
        model,
        tier,
        attempt: attempts,
        key_id: keyID,
        channel: "key",
        anonymous: false,
        proxy_node: "",
        status,
        duration_ms: durationMs,
        success,
        outcome: record.outcome,
      });

      if (success) {
        pool.markSuccess(node);
        this.logger.debug("upstream accepted request", "upstream", {
          event: "attempt_succeeded",
          request_id: requestID,
          attempt: attempts,
          tier,
          key_id: keyID,
          status,
          duration_ms: durationMs,
        });
        return {
          response,
          error: undefined,
          attempts,
          records,
          alias: shaped.alias,
          shaped: shaped.shaped,
        };
      }
      if (response !== undefined && isNonRetryableClientResponse(status)) {
        // A request-shape error is deterministic and must leave this tier
        // without rotating through unrelated keys.
        this.logger.debug("upstream rejected a non-retryable request", "upstream", {
          event: "attempt_rejected",
          request_id: requestID,
          attempt: attempts,
          tier,
          key_id: keyID,
          status,
          duration_ms: durationMs,
        });
        return {
          response,
          error: undefined,
          attempts,
          records,
          alias: shaped.alias,
          shaped: shaped.shaped,
        };
      }
      pool.markFailure(
        node,
        status,
        parseRetryAfterHeader(response?.headers),
        this.timeoutSeconds,
      );
      lastResponse = response;
      lastError = error;
    }
    return {
      response: lastResponse,
      error: lastError,
      attempts,
      records,
      alias: shaped.alias,
      shaped: shaped.shaped,
    };
  }

  // runAnonymous tries the anonymous lane with the shared public credential.
  // The v1 /zen lane is tried first, then the v2 /inference lane, because the
  // two gates accept different request shapes.
  async runAnonymous(
    protocol: Protocol,
    body: string,
    ids: RequestIDs,
    requestID: string,
    model: string,
  ): Promise<AttemptOutcome> {
    const records: UpstreamAttemptRecord[] = [];
    const upstreams = anonymousUpstreams(this.upstream);
    let lastResponse: UpstreamResponse | undefined;
    let lastError: Error | undefined;
    let lastAlias = "";
    let lastShaped = false;
    let attempts = 0;
    for (const baseURL of upstreams) {
      const result = await this.attemptAnonymous(
        baseURL,
        protocol,
        body,
        ids,
        requestID,
        model,
      );
      attempts += result.attempts;
      records.push(...result.records);
      if (result.response !== undefined && result.response.status < 300) {
        return {
          response: result.response,
          error: undefined,
          attempts,
          records,
          alias: result.alias,
          shaped: result.shaped,
        };
      }
      lastResponse = result.response ?? lastResponse;
      lastError = result.error ?? lastError;
      lastAlias = result.alias;
      lastShaped = result.shaped;
    }
    return {
      response: lastResponse,
      error: lastError,
      attempts,
      records,
      alias: lastAlias,
      shaped: lastShaped,
    };
  }

  // attemptAnonymous performs one anonymous attempt against one lane.
  private async attemptAnonymous(
    baseURL: string,
    protocol: Protocol,
    body: string,
    ids: RequestIDs,
    requestID: string,
    model: string,
  ): Promise<AttemptOutcome> {
    const records: UpstreamAttemptRecord[] = [];
    const shaped = shapeBody(body, protocol, baseURL);
    const started = Date.now();
    let response: UpstreamResponse | undefined;
    let error: Error | undefined;
    try {
      response = await sendRequest(
        baseURL,
        protocol,
        shaped.shaped ? shaped.body : body,
        ids,
        ANONYMOUS_CREDENTIAL,
        this.timeoutSeconds,
      );
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    }
    const durationMs = Date.now() - started;
    const status = response?.status ?? 0;
    const success = error === undefined && status >= 200 && status < 300;
    const record: UpstreamAttemptRecord = {
      time: new Date().toISOString(),
      request_id: requestID,
      model,
      tier: "zen",
      attempt: records.length + 1,
      key_id: "anonymous",
      channel: "anonymous",
      anonymous: true,
      proxy_node: "",
      status,
      duration_ms: durationMs,
      success,
      outcome: success ? "success" : outcomeFor(status, error),
    };
    records.push(record);
    this.metrics.recordAttempt({
      time: record.time,
      request_id: requestID,
      model,
      tier: "zen",
      attempt: record.attempt,
      key_id: "anonymous",
      channel: "anonymous",
      anonymous: true,
      proxy_node: "",
      status,
      duration_ms: durationMs,
      success,
      outcome: record.outcome,
    });
    return {
      response,
      error,
      attempts: 1,
      records,
      alias: shaped.alias,
      shaped: shaped.shaped,
    };
  }
}
