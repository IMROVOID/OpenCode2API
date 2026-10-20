import type { BridgeStreamEvent } from "./stream-types.js";
import type { ProtocolStreamParser } from "./stream-parser-types.js";
import { firstString, mapAt, sliceAt, stringAt } from "./json-util.js";
import { decodeResponsesReasoning } from "./decode-reasoning.js";
import { canonicalResponsesIncomplete, decodeOpenAIUsage } from "./response-usage.js";
import { streamEvent } from "./stream-types.js";
import {
  responseToolKey,
  streamErrorMessage,
  streamErrorType,
  ToolTracker,
} from "./stream-parser-shared.js";

// ResponsesStreamParser turns Responses events into bridge events. A tool call
// is only announced once its item is known, and a closing event never repeats
// arguments or reasoning that already arrived as a delta.
export class ResponsesStreamParser implements ProtocolStreamParser {
  private readonly tracker = new ToolTracker();

  parse(
    eventName: string,
    value: Record<string, unknown>,
  ): BridgeStreamEvent[] {
    const typeName = stringAt(value, "type") || eventName;
    switch (typeName) {
      case "error":
        return [
          streamEvent("error", {
            error: streamErrorMessage(
              value,
              "upstream Responses stream error",
            ),
            errorType: streamErrorType(value),
          }),
        ];
      case "response.created": {
        const response = mapAt(value, "response");
        return [
          streamEvent("start", {
            responseID: stringAt(response, "id"),
            model: stringAt(response, "model"),
          }),
        ];
      }
      case "response.output_text.delta":
        return [streamEvent("text", { text: stringAt(value, "delta") })];
      case "response.reasoning_summary_text.delta": {
        this.tracker.markReasoning(responseToolKey(value, undefined));
        return [streamEvent("reasoning", { text: stringAt(value, "delta") })];
      }
      case "response.output_item.added":
        return this.outputItemAdded(value);
      case "response.function_call_arguments.delta":
        return this.argumentsDelta(value);
      case "response.function_call_arguments.done":
        return this.argumentsDone(value);
      case "response.output_item.done":
        return this.outputItemDone(value);
      case "response.completed":
      case "response.incomplete":
      case "response.failed":
      case "response.done":
        return this.terminated(typeName, value);
      default:
        return [];
    }
  }

  private outputItemAdded(
    value: Record<string, unknown>,
  ): BridgeStreamEvent[] {
    const item = mapAt(value, "item");
    if (stringAt(item, "type") !== "function_call") {
      return [];
    }
    const key = responseToolKey(value, item);
    this.tracker.ensure(key);
    this.tracker.setID(key, stringAt(item, "call_id"));
    this.tracker.setName(key, stringAt(item, "name"));
    if (this.tracker.name(key) === "") {
      return [];
    }
    this.tracker.markStarted(key);
    return [this.toolStart(key)];
  }

  private argumentsDelta(value: Record<string, unknown>): BridgeStreamEvent[] {
    const key = responseToolKey(value, undefined);
    this.tracker.markArguments(key);
    return [
      streamEvent("tool_delta", {
        toolKey: key,
        toolID: this.tracker.id(key),
        toolName: this.tracker.name(key),
        text: stringAt(value, "delta"),
      }),
    ];
  }

  private argumentsDone(value: Record<string, unknown>): BridgeStreamEvent[] {
    const key = responseToolKey(value, undefined);
    if (this.tracker.hasArguments(key)) {
      return [];
    }
    this.tracker.markArguments(key);
    return [
      streamEvent("tool_delta", {
        toolKey: key,
        toolID: this.tracker.id(key),
        toolName: this.tracker.name(key),
        text: stringAt(value, "arguments"),
      }),
    ];
  }

  private outputItemDone(value: Record<string, unknown>): BridgeStreamEvent[] {
    const item = mapAt(value, "item");
    const type = stringAt(item, "type");
    if (type === "reasoning") {
      return this.reasoningDone(value, item);
    }
    if (type !== "function_call") {
      return [];
    }
    const key = responseToolKey(value, item);
    this.tracker.ensure(key);
    this.tracker.setID(key, stringAt(item, "call_id"));
    this.tracker.setName(key, stringAt(item, "name"));
    const events: BridgeStreamEvent[] = [];
    if (!this.tracker.isStarted(key)) {
      this.tracker.markStarted(key);
      events.push(this.toolStart(key));
    }
    if (!this.tracker.hasArguments(key)) {
      const args = stringAt(item, "arguments");
      if (args !== "") {
        events.push(streamEvent("tool_delta", { toolKey: key, text: args }));
      }
    }
    return events;
  }

  private reasoningDone(
    value: Record<string, unknown>,
    item: Record<string, unknown>,
  ): BridgeStreamEvent[] {
    const key = responseToolKey(value, item);
    if (this.tracker.hasReasoning(key)) {
      return [];
    }
    const first = decodeResponsesReasoning(item)[0];
    if (first === undefined) {
      return [];
    }
    return [
      streamEvent("reasoning", {
        text: first.text,
        encrypted: first.encrypted,
      }),
    ];
  }

  private terminated(
    typeName: string,
    value: Record<string, unknown>,
  ): BridgeStreamEvent[] {
    const response = mapAt(value, "response");
    const usageMap = mapAt(response, "usage");
    if (
      typeName === "response.failed" ||
      stringAt(response, "status") === "failed"
    ) {
      const errorEvent = streamEvent("error", {
        error: firstString(
          stringAt(response, "error", "message"),
          stringAt(value, "error", "message"),
          "upstream Responses request failed",
        ),
        errorType: firstString(
          stringAt(response, "error", "code"),
          "upstream_error",
        ),
      });
      if (Object.keys(usageMap).length === 0) {
        return [errorEvent];
      }
      return [
        streamEvent("usage", { usage: decodeOpenAIUsage(usageMap) }),
        errorEvent,
      ];
    }
    const stop =
      typeName === "response.incomplete"
        ? canonicalResponsesIncomplete(
            stringAt(response, "incomplete_details", "reason"),
          )
        : this.completedStop(response);
    const events: BridgeStreamEvent[] = [];
    if (Object.keys(usageMap).length > 0) {
      events.push(streamEvent("usage", { usage: decodeOpenAIUsage(usageMap) }));
    }
    events.push(streamEvent("finish", { stop }));
    events.push(streamEvent("done"));
    return events;
  }

  // completedStop decides how a finished Responses turn is reported. The
  // completed event carries no stop reason, so the function_call items in its
  // output — or the tool calls seen earlier — are the only signal that the
  // turn ended waiting for tool results.
  private completedStop(response: Record<string, unknown>): string {
    for (const raw of sliceAt(response, "output")) {
      if (stringAt(mapAt(raw), "type") === "function_call") {
        return "tool_calls";
      }
    }
    return this.tracker.keys().length > 0 ? "tool_calls" : "stop";
  }

  private toolStart(key: string): BridgeStreamEvent {
    return streamEvent("tool_start", {
      toolKey: key,
      toolID: this.tracker.id(key),
      toolName: this.tracker.name(key),
    });
  }
}
