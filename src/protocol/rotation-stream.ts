import type { Protocol } from "../types/config.js";
import type { Usage } from "../types/inference.js";
import { SSEReader } from "./sse.js";
import { StreamCodec } from "./stream-encoder.js";
import { StreamParser } from "./stream-parser.js";
import {
  errStreamNormalTermination,
  type BridgeStreamEvent,
  type StreamSink,
} from "./stream-types.js";

// The in-band message a committed stream ends with when the upstream output is
// interrupted.
export const ROTATION_INTERRUPTED_MESSAGE =
  "当前上游模型的输出中断；本次响应已结束，请重新发起请求。";

// The maximum number of events that may be held back before the attempt is
// considered malformed.
const MAX_PENDING_EVENTS = 256;

// StreamFailure classifies a failed upstream stream without putting its raw
// text into the returned error. Message holds the upstream error text so a
// caller can classify the failure without returning that text to the client;
// Type holds the upstream error type.
export class StreamFailure extends Error {
  readonly message: string;
  readonly type: string;

  constructor(message: string, type: string) {
    super("upstream stream failed");
    this.message = message;
    this.type = type;
  }
}

// RotationResult reports what the rotation stream produced.
export interface RotationResult {
  usage: Usage;
  reported: boolean;
  committed: boolean;
  error: Error | undefined;
}

// rotationStream streams one upstream response to the client while holding
// back events until the attempt is worth committing to.
//
// Events that carry no output (start, usage, finish) are held until an
// effective event arrives: text, reasoning, a reasoning signature, a tool
// start or delta, or done. At that point ready is called, the attempt is
// marked committed, and the held events are emitted first. If 256 events are
// already held and another non-effective one arrives, the attempt fails with
// invalid_prelude. An upstream error event before that point is returned as a
// StreamFailure so the caller can rotate to another model; once committed, a
// failure is emitted in-band and never replayed. The event model is always
// cleared, because the emitter's model is the requested alias for the whole
// response.
export async function rotationStream(
  source: AsyncIterable<Uint8Array>,
  sink: StreamSink,
  from: Protocol,
  to: Protocol,
  alias: string,
  ready: () => void,
): Promise<RotationResult> {
  const parser = new StreamParser(from);
  const codec = new StreamCodec(sink, to, alias);
  const reader = new SSEReader();
  let committed = false;
  let pending: BridgeStreamEvent[] = [];
  let upstreamFailure: StreamFailure | undefined;
  let readError: Error | undefined;

  const emit = (event: BridgeStreamEvent): void => {
    // The emitter's model is the requested alias for the whole response.
    codec.emit({ ...event, model: "" });
  };

  const read = async (): Promise<void> => {
    for await (const chunk of source) {
      for (const record of reader.push(chunk)) {
        let events: BridgeStreamEvent[];
        try {
          events = parser.parse(record.event, record.data);
        } catch {
          throw new StreamFailure("", "parse_error");
        }
        for (const event of events) {
          if (event.kind === "error") {
            upstreamFailure = new StreamFailure(event.error, event.errorType);
            throw upstreamFailure;
          }
          if (!committed) {
            if (!isEffective(event)) {
              if (pending.length >= MAX_PENDING_EVENTS) {
                throw new StreamFailure("", "invalid_prelude");
              }
              pending = [...pending, event];
              continue;
            }
            ready();
            committed = true;
            for (const held of pending) {
              emit(held);
            }
            pending = [];
          }
          emit(event);
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
  if (readError === undefined || readError === errStreamNormalTermination) {
    return { usage, reported, committed, error: undefined };
  }
  if (upstreamFailure !== undefined) {
    return { usage, reported, committed, error: upstreamFailure };
  }
  if (committed) {
    try {
      codec.emit(interruptedEvent());
    } catch {
      // The in-band report is best effort: the attempt already failed.
    }
  }
  return { usage, reported, committed, error: readError };
}

// isEffective reports whether an event carries output worth committing to.
function isEffective(event: BridgeStreamEvent): boolean {
  switch (event.kind) {
    case "text":
    case "reasoning":
    case "reasoning_signature":
    case "tool_start":
    case "tool_delta":
    case "done":
      return true;
    default:
      return false;
  }
}

// interruptedEvent builds the in-band error event a committed stream ends
// with when the upstream output was cut short.
function interruptedEvent(): BridgeStreamEvent {
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
    error: ROTATION_INTERRUPTED_MESSAGE,
    errorType: "upstream_error",
    encrypted: "",
    usage: undefined,
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
