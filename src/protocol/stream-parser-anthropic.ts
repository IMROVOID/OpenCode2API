import type { BridgeStreamEvent } from "./stream-types.js";
import type { ProtocolStreamParser } from "./stream-parser-types.js";
import { firstString, mapAt, stringAt } from "./json-util.js";
import { decodeAnthropicUsage } from "./response-usage.js";
import { streamEvent } from "./stream-types.js";
import { isStreamErrorFinish, sprint } from "./stream-parser-shared.js";

// AnthropicStreamParser turns Anthropic message events into bridge events.
// The payload's own type decides what an event is, falling back to the SSE
// event name when the payload carries none.
export class AnthropicStreamParser implements ProtocolStreamParser {
  parse(
    eventName: string,
    value: Record<string, unknown>,
  ): BridgeStreamEvent[] {
    const typeName = stringAt(value, "type") || eventName;
    switch (typeName) {
      case "message_start":
        return this.messageStart(value);
      case "content_block_start":
        return this.contentBlockStart(value);
      case "content_block_delta":
        return this.contentBlockDelta(value);
      case "message_delta":
        return this.messageDelta(value);
      case "message_stop":
        return [streamEvent("done")];
      case "error":
        return [
          streamEvent("error", {
            error: firstString(
              stringAt(value, "error", "message"),
              "upstream Anthropic stream error",
            ),
            errorType: firstString(
              stringAt(value, "error", "type"),
              "upstream_error",
            ),
          }),
        ];
      default:
        return [];
    }
  }

  private messageStart(value: Record<string, unknown>): BridgeStreamEvent[] {
    const message = mapAt(value, "message");
    const events = [
      streamEvent("start", {
        responseID: stringAt(message, "id"),
        model: stringAt(message, "model"),
      }),
    ];
    const usageMap = mapAt(message, "usage");
    if (Object.keys(usageMap).length > 0) {
      events.push(streamEvent("usage", { usage: decodeAnthropicUsage(usageMap) }));
    }
    return events;
  }

  private contentBlockStart(value: Record<string, unknown>): BridgeStreamEvent[] {
    const block = mapAt(value, "content_block");
    switch (stringAt(block, "type")) {
      case "thinking": {
        const events: BridgeStreamEvent[] = [];
        const thinking = stringAt(block, "thinking");
        if (thinking !== "") {
          events.push(streamEvent("reasoning", { text: thinking }));
        }
        const signature = stringAt(block, "signature");
        if (signature !== "") {
          events.push(streamEvent("reasoning_signature", { signature }));
        }
        return events;
      }
      case "redacted_thinking":
        return [
          streamEvent("reasoning", { encrypted: stringAt(block, "data") }),
        ];
      case "tool_use":
        return [
          streamEvent("tool_start", {
            toolKey: sprint(value["index"]),
            toolID: stringAt(block, "id"),
            toolName: stringAt(block, "name"),
          }),
        ];
      case "text": {
        const text = stringAt(block, "text");
        return text === "" ? [] : [streamEvent("text", { text })];
      }
      default:
        return [];
    }
  }

  private contentBlockDelta(value: Record<string, unknown>): BridgeStreamEvent[] {
    const delta = mapAt(value, "delta");
    switch (stringAt(delta, "type")) {
      case "thinking_delta":
        return [
          streamEvent("reasoning", { text: stringAt(delta, "thinking") }),
        ];
      case "signature_delta":
        return [
          streamEvent("reasoning_signature", {
            signature: stringAt(delta, "signature"),
          }),
        ];
      case "text_delta":
        return [streamEvent("text", { text: stringAt(delta, "text") })];
      case "input_json_delta":
        return [
          streamEvent("tool_delta", {
            toolKey: sprint(value["index"]),
            text: stringAt(delta, "partial_json"),
          }),
        ];
      default:
        return [];
    }
  }

  private messageDelta(value: Record<string, unknown>): BridgeStreamEvent[] {
    const events: BridgeStreamEvent[] = [];
    const usageMap = mapAt(value, "usage");
    if (Object.keys(usageMap).length > 0) {
      events.push(streamEvent("usage", { usage: decodeAnthropicUsage(usageMap) }));
    }
    const stop = stringAt(value, "delta", "stop_reason");
    if (stop === "") {
      return events;
    }
    if (isStreamErrorFinish(stop)) {
      events.push(
        streamEvent("error", {
          error: "upstream Anthropic stream failed",
          errorType: "upstream_error",
        }),
      );
      return events;
    }
    events.push(streamEvent("finish", { stop }));
    return events;
  }
}
