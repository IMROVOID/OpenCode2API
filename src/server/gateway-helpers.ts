import type { ServerResponse } from "node:http";
import type { Protocol } from "../types/config.js";
import { buildErrorEnvelope } from "../protocol/error.js";
import type { RequestMeta } from "../telemetry/metric-types.js";

// newRequestMeta builds an empty request trace.
export function newRequestMeta(): RequestMeta {
  return {
    modelAlias: "",
    model: "",
    tier: "",
    protocol: "",
    request: "",
    session: "",
    keyId: "",
    channel: "",
    anonymous: false,
    proxy: "",
    attempts: 0,
    legs: [],
    stop: "",
    tail: "",
    stream: false,
    serverKeyId: "",
    shaped: false,
    toolAlias: "",
    usage: undefined,
    usageReported: false,
    attemptOutcome: "",
    outcome: "",
  };
}

// writeError answers a request with the protocol's error envelope.
export function writeError(
  response: ServerResponse,
  protocol: Protocol,
  status: number,
  message: string,
  kind: string,
): void {
  const envelope = buildErrorEnvelope(protocol, status, message, kind as never);
  response.writeHead(envelope.status, {
    "Content-Type": "application/json",
  });
  response.end(`${JSON.stringify(envelope.body)}\n`);
}

// readAll reads a whole response body as text.
export async function readAll(
  stream: AsyncIterable<Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}
