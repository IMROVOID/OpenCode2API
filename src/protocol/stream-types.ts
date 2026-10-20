import type { Usage } from "../types/inference.js";

export type BridgeStreamKind =
  | "start"
  | "text"
  | "reasoning"
  | "reasoning_signature"
  | "tool_start"
  | "tool_delta"
  | "usage"
  | "finish"
  | "error"
  | "done";

// BridgeStreamEvent is one protocol-neutral streaming event. Every field is
// always present so the event can be compared and copied without optional
// handling; only the fields of the event's kind carry meaning.
export interface BridgeStreamEvent {
  kind: BridgeStreamKind;
  responseID: string;
  model: string;
  text: string;
  signature: string;
  toolKey: string;
  toolID: string;
  toolName: string;
  stop: string;
  error: string;
  errorType: string;
  encrypted: string;
  usage: Usage | undefined;
}

export function streamEvent(
  kind: BridgeStreamKind,
  fields: Partial<BridgeStreamEvent> = {},
): BridgeStreamEvent {
  return {
    kind,
    responseID: "",
    model: "",
    text: "",
    signature: "",
    toolKey: "",
    toolID: "",
    toolName: "",
    stop: "",
    error: "",
    errorType: "",
    encrypted: "",
    usage: undefined,
    ...fields,
  };
}

// The three stream sentinels are compared by identity, so each one is a
// distinct value rather than a shared message.
export const errStreamUpstreamFailure = new Error(
  "upstream stream failure delivered",
);
export const errStreamNormalTermination = new Error(
  "upstream stream terminated normally",
);
export const errSSEUnexpectedEOF = new Error("unexpected end of SSE stream");

// StreamSink receives the encoded SSE bytes. It is byte-oriented so a
// multi-byte character split across two writes is never corrupted.
export interface StreamSink {
  write(chunk: Uint8Array): void;
}

// StreamEncoder turns bridge stream events into one downstream protocol's SSE
// stream.
export interface StreamEncoder {
  emit(event: BridgeStreamEvent): void;
  finish(): void;
  readonly usage: Usage;
  readonly usageReported: boolean;
}
