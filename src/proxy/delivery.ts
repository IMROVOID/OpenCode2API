import type { Protocol, Tier } from "../types/config.js";
import type { RequestIDs } from "../protocol/identity.js";
import type { Route } from "../types/inference.js";
import { convertResponse, renameResponseTool } from "../protocol/response.js";
import { responseUsage } from "../protocol/response-encode.js";
import { collapseStream } from "../protocol/collapse.js";
import { forwardStream, transcodeStream } from "../protocol/stream.js";
import { StreamToolRenamer } from "../protocol/stream-renamer.js";
import { V1_READ_TOOL } from "../protocol/tools.js";
import type { StreamSink } from "../protocol/stream-types.js";

// The body limit the non-streaming path reads.
const RESPONSE_BODY_LIMIT = 64 * 1024 * 1024;

// UpstreamOutcome is what the upstream attempt produced.
export interface UpstreamOutcome {
  status: number;
  headers: Headers;
  stream: AsyncIterable<Uint8Array>;
}

// DeliveryResult is what the handler delivers to the client.
export interface DeliveryResult {
  status: number;
  headers: Headers;
  body: string;
  usage: ReturnType<typeof responseUsage>["usage"];
  usagePresent: boolean;
}

// deliverResponse converts an upstream response to the client's protocol and
// reports the usage it carried.
//
// The anonymous lane and a key-tier request shaped like it are force streamed
// upstream, so the events are collapsed back into the single document the
// non-streaming client asked for.
export async function deliverResponse(
  upstreamProtocol: Protocol,
  external: Protocol,
  outcome: UpstreamOutcome,
  model: string,
  toolAlias: string,
  shaped: boolean,
): Promise<DeliveryResult> {
  let body = await readBody(outcome);
  let text = decodeBody(body);
  if (shaped || isEventStream(outcome.headers)) {
    text = await collapseStream(bytesOf(text), upstreamProtocol, model);
  }
  text = renameResponseTool(text, upstreamProtocol, V1_READ_TOOL, toolAlias);
  const usage = responseUsage(upstreamProtocol, JSON.parse(text) as unknown);
  let converted = text;
  if (upstreamProtocol !== external) {
    converted = convertResponse(upstreamProtocol, external, text);
  }
  return {
    status: outcome.status,
    headers: outcome.headers,
    body: converted,
    usage: usage.usage,
    usagePresent: usage.present,
  };
}

// deliverStream relays or transcodes an upstream stream to the client. The
// tool alias is restored on the way out, so a client sees its own tool name
// again.
export async function deliverStream(
  upstreamProtocol: Protocol,
  external: Protocol,
  outcome: UpstreamOutcome,
  model: string,
  toolAlias: string,
  sink: StreamSink,
): Promise<{ usage: DeliveryResult["usage"]; usagePresent: boolean; error: Error | undefined }> {
  const source = renameStream(outcome.stream, upstreamProtocol, toolAlias);
  const result =
    upstreamProtocol === external
      ? await forwardStream(source, sink, upstreamProtocol, model)
      : await transcodeStream(source, sink, upstreamProtocol, external, model);
  return {
    usage: result.usage,
    usagePresent: result.reported,
    error: result.error,
  };
}

// renameStream rewrites the tool names of a relayed stream. A stream without
// a tool alias is relayed unchanged.
function renameStream(
  source: AsyncIterable<Uint8Array>,
  protocol: Protocol,
  toolAlias: string,
): AsyncIterable<Uint8Array> {
  if (toolAlias === "") {
    return source;
  }
  const renamer = new StreamToolRenamer(protocol, V1_READ_TOOL, toolAlias);
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      const encoder = new TextEncoder();
      let pending = "";
      for await (const chunk of source) {
        pending += new TextDecoder().decode(chunk, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        const rewritten = lines
          .map((line) => rewriteLine(line, renamer))
          .join("\n");
        if (rewritten !== "") {
          yield encoder.encode(`${rewritten}\n`);
        }
      }
      if (pending !== "") {
        yield encoder.encode(rewriteLine(pending, renamer));
      }
    },
  };
}

// rewriteLine rewrites the data line of an SSE frame, preserving its original
// bytes when nothing needed rewriting.
function rewriteLine(line: string, renamer: StreamToolRenamer): string {
  if (!line.startsWith("data:")) {
    return line;
  }
  const raw = line.slice("data:".length).trim();
  if (raw === "" || raw === "[DONE]") {
    return line;
  }
  const rewritten = renamer.rewriteFrame(raw);
  if (rewritten === raw) {
    return line;
  }
  return `data: ${rewritten}`;
}

// readBody reads the whole upstream body, bounded by the response limit.
async function readBody(outcome: UpstreamOutcome): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of outcome.stream) {
    total += chunk.byteLength;
    if (total > RESPONSE_BODY_LIMIT) {
      throw new Error("upstream response exceeded the 64 MiB limit");
    }
    chunks.push(chunk);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

// decodeBody decodes a body into text.
function decodeBody(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}

// bytesOf turns text into a byte stream.
function bytesOf(text: string): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      yield encoder.encode(text);
    },
  };
}

// isEventStream reports whether a response carries an SSE stream.
function isEventStream(headers: Headers): boolean {
  return (headers.get("content-type") ?? "").includes("text/event-stream");
}

// tierOf returns the tier a route's primary lane uses.
export function tierOf(route: Route): Tier {
  return route.tier;
}

export type { RequestIDs };
