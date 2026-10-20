import type { Usage } from "../types/inference.js";
import type { Protocol } from "../types/config.js";
import { SSEReader } from "./sse.js";
import { StreamParser } from "./stream-parser.js";
import { mergeBridgeUsage } from "./stream-writer.js";

// StreamUsageTracker reads a relayed SSE stream and reports its usage. It
// never modifies the bytes it is given: it only parses the frames they
// contain, so the same bytes can still be forwarded verbatim.
export class StreamUsageTracker {
  private readonly parser: StreamParser;
  private readonly reader = new SSEReader();
  private usage: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
  };
  private reported = false;
  private normal = false;
  private error = false;
  private parseError: Error | undefined;

  constructor(protocol: Protocol) {
    this.parser = new StreamParser(protocol);
  }

  // observe consumes the relayed bytes and records the terminal events and the
  // usage. A parse error is remembered but not thrown, because the relay must
  // keep copying bytes.
  observe(chunk: Uint8Array): void {
    for (const record of this.reader.push(chunk)) {
      this.consume(record.event, record.data);
    }
  }

  // finish returns the merged usage and discards the buffered tail. A tail
  // that was never terminated by a blank line is not an SSE frame, so a usage
  // object from a response that was cut off at EOF is not counted.
  finish(): Usage {
    this.reader.close();
    return this.usage;
  }

  wasReported(): boolean {
    return this.reported;
  }

  normalTermination(): boolean {
    return this.normal;
  }

  errorTermination(): boolean {
    return this.error;
  }

  parseFailure(): Error | undefined {
    return this.parseError;
  }

  private consume(eventName: string, data: string): void {
    let events;
    try {
      events = this.parser.parse(eventName, data);
    } catch (error) {
      if (this.parseError === undefined) {
        this.parseError = asError(error);
      }
      return;
    }
    for (const event of events) {
      if (event.kind === "done") {
        this.normal = true;
      }
      if (event.kind === "error") {
        this.error = true;
      }
      if (event.usage !== undefined) {
        this.reported = true;
        this.usage = mergeBridgeUsage(this.usage, event.usage);
      }
    }
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
