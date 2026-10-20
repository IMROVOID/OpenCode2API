import type { ServerResponse } from "node:http";
import type { Protocol, Tier } from "../types/config.js";
import type { Route } from "../types/inference.js";
import { boolAt, isPlainObject } from "../protocol/json-util.js";
import { deriveRequestIDs } from "../protocol/request-identity.js";
import { isV1Upstream } from "../protocol/lanes.js";
import { deliverResponse, deliverStream } from "../proxy/delivery.js";
import { prepareRouteBodies, requestModel } from "../proxy/request-shaping.js";
import type { RequestMeta } from "../telemetry/metric-types.js";
import type { Gateway } from "./gateway.js";
import { newRequestMeta, readAll, writeError } from "./gateway-helpers.js";

// The outcome of one upstream attempt.
export interface UpstreamOutcome {
  status: number;
  headers: Headers;
  stream: AsyncIterable<Uint8Array>;
  alias: string;
  shaped: boolean;
}

// handleCompletion serves one completion request. It routes the request to
// the upstream lane that can serve it, then relays or converts the answer.
export async function handleCompletion(
  gateway: Gateway,
  protocol: Protocol,
  body: Buffer,
  headers: NodeJS.Dict<string | string[]>,
  response: ServerResponse,
  scope: string,
): Promise<void> {
  const meta = newRequestMeta();
  gateway.metrics.enter();
  const started = Date.now();
  let status = 500;
  try {
    const payload = parsePayload(body);
    if (payload === undefined) {
      status = 400;
      writeError(
        response,
        protocol,
        400,
        "request body must be a JSON object",
        "invalid_request_error",
      );
      return;
    }
    const model = requestModel(payload);
    if (model === "") {
      status = 400;
      writeError(
        response,
        protocol,
        400,
        "model is required",
        "invalid_request_error",
      );
      return;
    }
    let route: Route;
    try {
      route = gateway.catalog.route(
        model,
        gateway.hasZenKeys(),
        gateway.hasGoKeys(),
        gateway.current().anonymous,
      );
    } catch (error) {
      status = 400;
      writeError(
        response,
        protocol,
        400,
        error instanceof Error ? error.message : "model is not available",
        "invalid_request_error",
      );
      return;
    }
    meta.model = model;
    meta.modelAlias = model;
    meta.tier = route.tier;
    meta.protocol = route.protocol;

    const ids = deriveRequestIDs(headers as never, payload, scope);
    meta.request = ids.request;
    meta.session = ids.session;

    const { bodies } = prepareRouteBodies(
      route,
      payload,
      (tier: Tier) => isV1Upstream(gateway.tierBase(tier)),
    );

    const stream = boolAt(payload, "stream") === true;
    meta.stream = stream;

    const outcome = await callUpstream(gateway, route, bodies, ids, model, meta);
    if (outcome === undefined) {
      status = 502;
      meta.outcome = "upstream_error";
      writeError(
        response,
        protocol,
        502,
        "all upstream attempts failed",
        "upstream_error",
      );
      return;
    }
    // The upstream lane reports the tool name it aliased and whether it
    // force streamed the request, so the response can be restored and
    // collapsed back.
    meta.shaped = outcome.shaped;
    meta.toolAlias = outcome.alias;
    status = outcome.status;
    response.setHeader("x-request-id", ids.request);

    if (outcome.status < 200 || outcome.status >= 300) {
      meta.outcome = outcome.status >= 500 ? "server_error" : "client_error";
      const text = await readAll(outcome.stream);
      response.writeHead(outcome.status, {
        "Content-Type":
          outcome.headers.get("content-type") ?? "application/json",
      });
      response.end(text);
      return;
    }

    if (stream) {
      gateway.metrics.enterStream();
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "x-request-id": ids.request,
      });
      const delivered = await deliverStream(
        route.protocol,
        protocol,
        outcome,
        model,
        outcome.alias,
        {
          write(chunk: Uint8Array): void {
            response.write(chunk);
          },
        },
      );
      gateway.metrics.leaveStream();
      meta.usage = delivered.usage;
      meta.usageReported = delivered.usagePresent;
      if (delivered.error !== undefined) {
        meta.outcome = "stream_error";
      }
      response.end();
      return;
    }

    const delivered = await deliverResponse(
      route.protocol,
      protocol,
      outcome,
      model,
      outcome.alias,
      outcome.shaped,
    );
    meta.usage = delivered.usage;
    meta.usageReported = delivered.usagePresent;
    response.writeHead(200, {
      "Content-Type": "application/json",
      "x-request-id": ids.request,
    });
    response.end(delivered.body);
  } catch (error) {
    status = 502;
    meta.outcome = "upstream_error";
    gateway.logger.warn("upstream request failed", "upstream", {
      event: "request_failed",
      request_id: meta.request,
      error: error instanceof Error ? error.message : String(error),
    });
    if (!response.headersSent) {
      writeError(
        response,
        protocol,
        502,
        "all upstream attempts failed",
        "upstream_error",
      );
    }
  } finally {
    gateway.metrics.leave();
    gateway.metrics.record("/v1/completions", status, Date.now() - started, meta);
  }
}

// callUpstream walks the route's lanes until one of them answers.
async function callUpstream(
  gateway: Gateway,
  route: Route,
  bodies: { zen: string; go: string },
  ids: ReturnType<typeof deriveRequestIDs>,
  model: string,
  meta: RequestMeta,
): Promise<UpstreamOutcome | undefined> {
  if (route.anonymous) {
    const result = await gateway.runner.runAnonymous(
      route.protocol,
      bodies.zen,
      ids,
      ids.request,
      model,
    );
    meta.attempts += result.attempts;
    meta.anonymous = true;
    meta.channel = "anonymous";
    if (result.response !== undefined && result.response.status < 300) {
      return { ...result.response, alias: result.alias, shaped: result.shaped };
    }
  }
  const tiers = route.keyTiers.length > 0 ? route.keyTiers : [route.tier];
  let lastResponse: UpstreamOutcome | undefined;
  for (const tier of tiers) {
    const result = await gateway.runner.runTier(
      tier,
      route.protocol,
      bodies[tier] ?? bodies.zen,
      ids,
      ids.request,
      model,
    );
    meta.attempts += result.attempts;
    meta.tier = tier;
    meta.channel = "key";
    meta.keyId = result.records[result.records.length - 1]?.key_id ?? "";
    if (result.response === undefined) {
      continue;
    }
    if (result.response.status < 300) {
      return { ...result.response, alias: result.alias, shaped: result.shaped };
    }
    // The last failure is reported to the client as it is, so the reason the
    // upstream rejected the request stays visible.
    lastResponse = { ...result.response, alias: result.alias, shaped: result.shaped };
  }
  return lastResponse;
}

// parsePayload decodes a request body into a JSON object.
function parsePayload(body: Buffer): Record<string, unknown> | undefined {
  if (body.length === 0) {
    return {};
  }
  let value: unknown;
  try {
    value = JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
  return isPlainObject(value) ? value : undefined;
}
