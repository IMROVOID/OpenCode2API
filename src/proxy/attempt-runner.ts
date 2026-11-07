import type { Protocol, Tier } from "../types/config.js";
import type { RequestIDs } from "../protocol/identity.js";
import { isNonRetryableClientResponse } from "../protocol/upstream-request.js";
import { tierBaseURL } from "../protocol/lanes.js";
import type { Logger } from "../telemetry/logger.js";
import type { Metrics } from "../telemetry/metrics.js";
import type { UpstreamAttemptRecord } from "../types/inference.js";
import { KeyPool } from "../auth/key-pool.js";
import {
  DEFAULT_AAAA_POOL,
  UnlimitedGuard,
  kiloFallbackChain,
} from "../unlimited/index.js";
import {
  ANONYMOUS_CREDENTIAL,
  type UpstreamResponse,
} from "./upstream-client.js";
import {
  anonymousUpstreams,
  attemptKiloAnonymous,
  buildAttemptRecord,
  keyDisplayOf,
  parseRetryAfterHeader,
  sendRequest,
  shapeBody,
  type AttemptOutcome,
} from "./attempt-helpers.js";

// AttemptRunner walks the keys of a tier and returns the first successful
// response. A 401, 403 or 429 rotates to the next key, and any other 4xx is
// returned immediately because retrying it on another key cannot help.
export class AttemptRunner {
  readonly guard = new UnlimitedGuard(DEFAULT_AAAA_POOL, "gateway");

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
      const lane = this.guard.current();
      try {
        response = await sendRequest(
          baseURL,
          routeProtocol,
          sendBody,
          ids,
          node.key,
          this.timeoutSeconds,
          lane.edge,
        );
      } catch (caught) {
        error = caught instanceof Error ? caught : new Error(String(caught));
      }
      const durationMs = Date.now() - started;
      const status = response?.status ?? 0;
      const keyID = keyDisplayOf(node.key);
      const record = buildAttemptRecord(this.metrics, {
        requestID,
        model,
        tier,
        attempt: attempts,
        keyID,
        channel: "key",
        anonymous: false,
        proxyNode: lane.edge,
        status,
        durationMs,
        error,
      });
      records.push(record);

      if (record.success) {
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
      if (status === 429) {
        this.guard.hop(undefined, true);
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

  // runAnonymous tries the anonymous lane with the shared public credential
  // and self-healing guard rotation on quota walls (429 / FreeTierError).
  async runAnonymous(
    protocol: Protocol,
    body: string,
    ids: RequestIDs,
    requestID: string,
    model: string,
  ): Promise<AttemptOutcome> {
    const records: UpstreamAttemptRecord[] = [];
    const upstreams = anonymousUpstreams(this.upstream);
    let attempts = 0;

    const guarded = await this.guard.executeWithGuard(async (lane, hopAttempt) => {
      const activeIDs = hopAttempt === 1 ? ids : lane.ids;
      let lastOutcome: AttemptOutcome = {
        response: undefined,
        error: undefined,
        attempts: 0,
        records: [],
        alias: "",
        shaped: false,
      };
      for (const baseURL of upstreams) {
        const result = await this.attemptAnonymous(
          baseURL,
          protocol,
          body,
          activeIDs,
          requestID,
          model,
          lane.edge,
        );
        attempts += result.attempts;
        records.push(...result.records);
        lastOutcome = result;
        if (result.response !== undefined && result.response.status < 300) {
          return {
            status: result.response.status,
            bodyPreview: "",
            value: result,
          };
        }
      }
      if (protocol === "chat") {
        const kiloChain = kiloFallbackChain(model);
        const kiloModel = kiloChain[(hopAttempt - 1) % kiloChain.length] ?? "reflection/beam-free";
        const kiloResult = await attemptKiloAnonymous(
          this.metrics,
          this.timeoutSeconds,
          body,
          activeIDs,
          requestID,
          model,
          kiloModel,
        );
        attempts += kiloResult.attempts;
        records.push(...kiloResult.records);
        lastOutcome = kiloResult;
        if (kiloResult.response !== undefined && kiloResult.response.status < 300) {
          return {
            status: kiloResult.response.status,
            bodyPreview: "",
            value: kiloResult,
          };
        }
      }
      const status = lastOutcome.response?.status ?? 0;
      return {
        status,
        bodyPreview: status === 429 || status === 403 ? "QuotaExceeded" : "",
        value: lastOutcome,
      };
    });

    const final = guarded.value;
    return {
      response: final.response,
      error: final.response !== undefined && final.response.status < 300 ? undefined : final.error,
      attempts,
      records,
      alias: final.alias,
      shaped: final.shaped,
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
    edge: string,
  ): Promise<AttemptOutcome> {
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
        edge,
      );
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    }
    const durationMs = Date.now() - started;
    const status = response?.status ?? 0;
    const record = buildAttemptRecord(this.metrics, {
      requestID,
      model,
      tier: "zen",
      attempt: 1,
      keyID: "anonymous",
      channel: "anonymous",
      anonymous: true,
      proxyNode: edge,
      status,
      durationMs,
      error,
    });
    return {
      response,
      error,
      attempts: 1,
      records: [record],
      alias: shaped.alias,
      shaped: shaped.shaped,
    };
  }
}
