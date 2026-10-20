import type { BridgeStreamEvent } from "./stream-types.js";
import type { ProtocolStreamParser } from "./stream-parser-types.js";
import { firstString, mapAt, sliceAt, stringAt } from "./json-util.js";
import { decodeOpenAIUsage } from "./response-usage.js";
import { streamEvent } from "./stream-types.js";
import {
  isStreamErrorFinish,
  mergeToolName,
  sprint,
  streamErrorMessage,
  streamErrorType,
  ToolTracker,
} from "./stream-parser-shared.js";

// ChatStreamParser turns OpenAI Chat completion chunks into bridge events. The
// first chunk carrying an id opens the response, and a tool call is only
// announced once its name is known.
export class ChatStreamParser implements ProtocolStreamParser {
  private readonly tracker = new ToolTracker();
  private started = false;

  parse(
    eventName: string,
    value: Record<string, unknown>,
  ): BridgeStreamEvent[] {
    if (eventName === "error") {
      return [this.errorEvent(value, "upstream Chat stream error")];
    }
    if (value["error"] !== undefined && value["error"] !== null) {
      return [this.errorEvent(value, "upstream Chat stream error")];
    }
    const events: BridgeStreamEvent[] = [];
    if (!this.started) {
      const id = stringAt(value, "id");
      if (id !== "") {
        this.started = true;
        events.push(
          streamEvent("start", {
            responseID: id,
            model: stringAt(value, "model"),
          }),
        );
      }
    }
    const usageMap = mapAt(value, "usage");
    if (Object.keys(usageMap).length > 0) {
      events.push(streamEvent("usage", { usage: decodeOpenAIUsage(usageMap) }));
    }
    for (const raw of sliceAt(value, "choices")) {
      const choice = mapAt(raw);
      events.push(...this.parseChoice(choice));
    }
    return events;
  }

  private parseChoice(choice: Record<string, unknown>): BridgeStreamEvent[] {
    const events: BridgeStreamEvent[] = [];
    const delta = mapAt(choice, "delta");
    const reasoning = firstString(
      stringAt(delta, "reasoning_content"),
      stringAt(delta, "reasoning"),
    );
    if (reasoning !== "") {
      events.push(streamEvent("reasoning", { text: reasoning }));
    }
    const text = stringAt(delta, "content");
    if (text !== "") {
      events.push(streamEvent("text", { text }));
    }
    for (const rawCall of sliceAt(delta, "tool_calls")) {
      events.push(...this.parseToolCall(mapAt(rawCall)));
    }
    const stop = stringAt(choice, "finish_reason");
    if (stop !== "") {
      if (isStreamErrorFinish(stop)) {
        events.push(
          streamEvent("error", {
            error: firstString(
              stringAt(choice, "error", "message"),
              "upstream Chat stream failed",
            ),
            errorType: "upstream_error",
          }),
        );
        return events;
      }
      events.push(...this.startPendingTools());
      events.push(streamEvent("finish", { stop }));
    }
    return events;
  }

  private parseToolCall(call: Record<string, unknown>): BridgeStreamEvent[] {
    const events: BridgeStreamEvent[] = [];
    const key = sprint(firstAnyIndex(call));
    const fn = mapAt(call, "function");
    this.tracker.ensure(key);
    this.tracker.setID(key, stringAt(call, "id"));
    const name = stringAt(fn, "name");
    if (name !== "") {
      this.tracker.setName(
        key,
        mergeToolName(this.tracker.name(key), name),
      );
    }
    const args = stringAt(fn, "arguments");
    if (args === "") {
      return events;
    }
    if (!this.tracker.isStarted(key) && this.tracker.name(key) !== "") {
      this.tracker.markStarted(key);
      events.push(this.toolStart(key));
    }
    events.push(
      streamEvent("tool_delta", {
        toolKey: key,
        toolID: this.tracker.id(key),
        toolName: this.tracker.name(key),
        text: args,
      }),
    );
    return events;
  }

  // startPendingTools announces the calls whose arguments never arrived, so a
  // tool that only carries a name is still delivered to the client.
  private startPendingTools(): BridgeStreamEvent[] {
    const events: BridgeStreamEvent[] = [];
    for (const key of this.tracker.keys()) {
      if (!this.tracker.isStarted(key) && this.tracker.name(key) !== "") {
        this.tracker.markStarted(key);
        events.push(this.toolStart(key));
      }
    }
    return events;
  }

  private toolStart(key: string): BridgeStreamEvent {
    return streamEvent("tool_start", {
      toolKey: key,
      toolID: this.tracker.id(key),
      toolName: this.tracker.name(key),
    });
  }

  private errorEvent(
    value: Record<string, unknown>,
    fallback: string,
  ): BridgeStreamEvent {
    return streamEvent("error", {
      error: streamErrorMessage(value, fallback),
      errorType: streamErrorType(value),
    });
  }
}

// firstAnyIndex mirrors the tool key of a Chat call: the call's index, else
// its id, else a missing value.
function firstAnyIndex(call: Record<string, unknown>): unknown {
  const index = call["index"];
  if (index !== undefined && index !== null) {
    return index;
  }
  return stringAt(call, "id");
}
