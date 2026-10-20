import type { Protocol } from "../types/config.js";
import { mapAt } from "./json-util.js";
import { AnthropicStreamParser } from "./stream-parser-anthropic.js";
import { ChatStreamParser } from "./stream-parser-chat.js";
import { ResponsesStreamParser } from "./stream-parser-responses.js";
import type { ProtocolStreamParser } from "./stream-parser-types.js";
import { streamEvent, type BridgeStreamEvent } from "./stream-types.js";

// StreamParser turns one upstream protocol's SSE events into bridge stream
// events. It picks the parser for the upstream protocol once and forwards
// every event to it.
export class StreamParser {
  private readonly protocol: Protocol;
  private readonly parser: ProtocolStreamParser;

  constructor(protocol: Protocol) {
    this.protocol = protocol;
    this.parser = createParser(protocol);
  }

  // parse turns one SSE event into zero or more bridge events. A "[DONE]"
  // terminator is only valid on Chat, which uses it to end the stream.
  parse(eventName: string, data: string): BridgeStreamEvent[] {
    if (data === "[DONE]") {
      if (this.protocol !== "chat") {
        throw new Error(
          `unexpected [DONE] terminator for ${this.protocol} stream`,
        );
      }
      return [streamEvent("done")];
    }
    let value: unknown;
    try {
      value = JSON.parse(data) as unknown;
    } catch (error) {
      throw new Error(`invalid upstream SSE JSON: ${errorMessage(error)}`);
    }
    return this.parser.parse(eventName, mapAt(value));
  }
}

function createParser(protocol: Protocol): ProtocolStreamParser {
  switch (protocol) {
    case "chat":
      return new ChatStreamParser();
    case "anthropic":
      return new AnthropicStreamParser();
    case "responses":
      return new ResponsesStreamParser();
    default:
      throw new Error(`unsupported stream protocol "${protocol}"`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
