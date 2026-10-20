import type { Protocol } from "../types/config.js";
import type { Usage } from "../types/inference.js";
import { SSEReader } from "./sse.js";
import { StreamCodec } from "./stream-encoder.js";
import { StreamParser } from "./stream-parser.js";
import { StreamUsageTracker } from "./stream-usage-tracker.js";
import {
  errSSEUnexpectedEOF,
  errStreamNormalTermination,
  errStreamUpstreamFailure,
  type BridgeStreamEvent,
  type StreamSink,
} from "./stream-types.js";

// StreamResult reports what a relayed or transcoded stream produced.
export interface StreamResult {
  usage: Usage;
  reported: boolean;
  error: Error | undefined;
}

// forwardStream relays a same-protocol upstream stream to the client byte for
// byte, while a usage tracker reads the same bytes to parse the usage. The
// only bytes ever added are a synthetic in-band error event when the stream
// ended before a terminal event.
export async function forwardStream(
  source: AsyncIterable<Uint8Array>,
  sink: StreamSink,
  protocol: Protocol,
  model: string,
): Promise<StreamResult> {
  const tracker = new StreamUsageTracker(protocol);
  let copyError: Error | undefined;
  try {
    for await (const chunk of source) {
      tracker.observe(chunk);
      sink.write(chunk);
    }
  } catch (error) {
    copyError = asError(error);
  }
  const usage = tracker.finish();
  const reported = tracker.wasReported();
  if (tracker.errorTermination()) {
    return { usage, reported, error: copyError ?? errStreamUpstreamFailure };
  }
  if (tracker.normalTermination() && tracker.parseFailure() === undefined) {
    return { usage, reported, error: copyError };
  }
  const cause = copyError ?? tracker.parseFailure() ?? errSSEUnexpectedEOF;
  const emitted = emitUnexpectedStreamError(sink, protocol, model, cause);
  return { usage, reported, error: emitted ?? cause };
}

// transcodeStream parses an upstream stream of one protocol and re-encodes it
// for another, writing each downstream event as it arrives.
//
// A stream that ends without a terminal event is reported in-band with an
// error event first. A stream that failed in a way already reported in-band
// keeps that report and is not reported twice.
export async function transcodeStream(
  source: AsyncIterable<Uint8Array>,
  sink: StreamSink,
  from: Protocol,
  to: Protocol,
  model: string,
): Promise<StreamResult> {
  const parser = new StreamParser(from);
  const codec = new StreamCodec(sink, to, model);
  const reader = new SSEReader();
  const state: { termination: "open" | "normal" | "error" } = {
    termination: "open",
  };
  let readError: Error | undefined;

  const read = async (): Promise<void> => {
    for await (const chunk of source) {
      for (const record of reader.push(chunk)) {
        let events: BridgeStreamEvent[];
        try {
          events = parser.parse(record.event, record.data);
        } catch (error) {
          state.termination = "error";
          codec.emit(errorEvent(asError(error).message));
          throw errStreamUpstreamFailure;
        }
        for (const event of events) {
          if (event.kind === "done") {
            state.termination = "normal";
          }
          if (event.kind === "error") {
            state.termination = "error";
          }
          codec.emit(event);
          if (event.kind === "done") {
            throw errStreamNormalTermination;
          }
        }
      }
    }
  };

  try {
    await read();
  } catch (error) {
    if (error !== errStreamNormalTermination) {
      readError = asError(error);
    }
  }

  const usage = codec.usage;
  const reported = codec.usageReported;
  if (readError === undefined) {
    if (state.termination === "normal") {
      return { usage, reported, error: undefined };
    }
    if (state.termination === "error") {
      return { usage, reported, error: errStreamUpstreamFailure };
    }
    const emitted = emitUnexpectedStreamError(
      sink,
      to,
      model,
      errSSEUnexpectedEOF,
    );
    return { usage, reported, error: emitted ?? errSSEUnexpectedEOF };
  }
  if (readError === errStreamUpstreamFailure) {
    // The failure was already reported in-band by the emitter.
    return { usage, reported, error: readError };
  }
  if (state.termination === "open") {
    const emitted = emitUnexpectedStreamError(sink, to, model, readError);
    return { usage, reported, error: emitted ?? readError };
  }
  return { usage, reported, error: readError };
}

// emitUnexpectedStreamError reports a stream that ended without a terminal
// event, as an in-band error event in the downstream protocol. It returns
// undefined once that event is written, and the write error otherwise.
export function emitUnexpectedStreamError(
  sink: StreamSink,
  protocol: Protocol,
  model: string,
  cause: Error | undefined,
): Error | undefined {
  const message =
    cause !== undefined && cause !== errSSEUnexpectedEOF
      ? `upstream SSE stream failed: ${cause.message}`
      : "upstream SSE stream ended before a terminal event";
  const codec = new StreamCodec(sink, protocol, model);
  try {
    codec.emit(errorEvent(message));
  } catch (error) {
    if (error === errStreamUpstreamFailure) {
      return undefined;
    }
    return asError(error);
  }
  return undefined;
}

// errorEvent builds the in-band error event the emitter writes.
export function errorEvent(message: string): BridgeStreamEvent {
  return {
    kind: "error",
    responseID: "",
    model: "",
    text: "",
    signature: "",
    toolKey: "",
    toolID: "",
    toolName: "",
    stop: "",
    error: message,
    errorType: "upstream_error",
    encrypted: "",
    usage: undefined,
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
