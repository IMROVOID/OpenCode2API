import type { Usage } from "../types/inference.js";
import type { StreamSink } from "./stream-types.js";

// StreamTool accumulates one tool call while a stream is encoded. Key is the
// parser's stream key, ID and ItemID the call and output-item identifiers,
// Arguments the full argument text so far and EmittedArguments how much of it
// has reached the client in bytes. Index is the Chat index or the Responses
// output index, AnthropicIndex the content block index, and Started records
// whether the tool was opened downstream.
export interface StreamTool {
  key: string;
  id: string;
  itemID: string;
  name: string;
  arguments: string;
  index: number;
  anthropicIndex: number;
  started: boolean;
  emittedArguments: number;
}

// StreamState is the text and usage a stream has accumulated so far. The
// writers read it to build the closing events, which repeat the whole text.
export interface StreamState {
  id: string;
  model: string;
  created: number;
  text: string;
  reasoning: string;
  reasoningSignature: string;
  reasoningEncrypted: string;
  stop: string;
  usage: Usage;
  tools: StreamTool[];
}

// StreamWriter is one downstream protocol's half of the encoder. Each writer
// owns the block ordering of its protocol, so the shared encoder only decides
// which events to forward.
export interface StreamWriter {
  start(): void;
  emitText(text: string): void;
  emitReasoning(text: string): void;
  emitReasoningSignature(signature: string): void;
  startTool(tool: StreamTool): void;
  emitToolDelta(tool: StreamTool, delta: string): void;
  emitError(message: string, errorType: string): void;
  finish(state: StreamState): void;
}
// SSEWriter writes SSE events to a sink, one event per flush.
export class SSEWriter {
  private readonly sink: StreamSink;
  private readonly encoder = new TextEncoder();

  constructor(sink: StreamSink) {
    this.sink = sink;
  }

  // sse writes value as the data of one SSE event.
  sse(eventName: string, value: unknown): void {
    this.rawSSE(eventName, JSON.stringify(value));
  }

  // rawSSE writes one SSE event. An empty event name omits the event line, as
  // Chat streams do.
  rawSSE(eventName: string, data: string): void {
    let frame = "";
    if (eventName !== "") {
      frame += `event: ${eventName}\n`;
    }
    frame += `data: ${data}\n\n`;
    this.sink.write(this.encoder.encode(frame));
  }
}

// mergeBridgeUsage folds a usage report into the accumulated usage. A non-zero
// field replaces the stored one, Total keeps the larger of the two, and Total
// is finally raised to at least Input+Output so a report that leaves it out
// still adds up.
export function mergeBridgeUsage(destination: Usage, source: Usage): Usage {
  const merged: Usage = {
    inputTokens:
      source.inputTokens !== 0 ? source.inputTokens : destination.inputTokens,
    outputTokens:
      source.outputTokens !== 0
        ? source.outputTokens
        : destination.outputTokens,
    totalTokens:
      source.totalTokens !== 0
        ? Math.max(destination.totalTokens, source.totalTokens)
        : destination.totalTokens,
    cachedInputTokens:
      source.cachedInputTokens !== 0
        ? source.cachedInputTokens
        : destination.cachedInputTokens,
    cacheCreationTokens:
      source.cacheCreationTokens !== 0
        ? source.cacheCreationTokens
        : destination.cacheCreationTokens,
    reasoningTokens:
      source.reasoningTokens !== 0
        ? source.reasoningTokens
        : destination.reasoningTokens,
  };
  merged.totalTokens = Math.max(
    merged.totalTokens,
    merged.inputTokens + merged.outputTokens,
  );
  return merged;
}
