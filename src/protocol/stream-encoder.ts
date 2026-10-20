import type { Protocol } from "../types/config.js";
import type { Usage } from "../types/inference.js";
import { ANTHROPIC_REDACTED_THINKING_PLACEHOLDER } from "./block.js";
import { randomID } from "./identity.js";
import { firstString } from "./json-util.js";
import { isToolStop } from "./response-usage.js";
import { ChatWriter } from "./stream-writer-chat.js";
import { AnthropicWriter } from "./stream-writer-anthropic.js";
import { ResponsesWriter } from "./stream-writer-responses.js";
import {
  SSEWriter,
  mergeBridgeUsage,
  type StreamState,
  type StreamTool,
  type StreamWriter,
} from "./stream-writer.js";
import {
  errStreamUpstreamFailure,
  type BridgeStreamEvent,
  type StreamEncoder,
  type StreamSink,
} from "./stream-types.js";

const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  reasoningTokens: 0,
};

// StreamCodec turns bridge stream events into one downstream protocol's SSE
// stream. It opens the response on the first start or content event (or on
// finish when the stream carried none), tracks which text, reasoning and tool
// blocks are open so each protocol's block ordering is respected, and records
// usage as it goes.
export class StreamCodec implements StreamEncoder {
  private readonly writer: StreamWriter;
  private readonly state: StreamState;
  private readonly tools = new Map<string, StreamTool>();
  private order: string[] = [];
  private started = false;
  private done = false;

  constructor(
    sink: StreamSink,
    target: Protocol,
    model: string,
    created: number = Math.floor(Date.now() / 1000),
  ) {
    const sse = new SSEWriter(sink);
    this.state = {
      id: "",
      model,
      created,
      text: "",
      reasoning: "",
      reasoningSignature: "",
      reasoningEncrypted: "",
      stop: "",
      usage: { ...EMPTY_USAGE },
      tools: [],
    };
    this.writer = this.createWriter(sse, target, this.state, created);
  }

  private createWriter(
    sse: SSEWriter,
    target: Protocol,
    state: StreamState,
    created: number,
  ): StreamWriter {
    switch (target) {
      case "chat":
        return new ChatWriter(sse, state, created);
      case "anthropic":
        return new AnthropicWriter(sse, state);
      case "responses":
        return new ResponsesWriter(sse, state, created);
      default:
        throw new Error(`unsupported stream target "${target}"`);
    }
  }

  private usageSeen = false;

  get usage(): Usage {
    return this.state.usage;
  }

  get usageReported(): boolean {
    return this.usageSeen;
  }

  // emit encodes one bridge stream event for the target protocol. The response
  // is opened before the first start or content event. An error event writes an
  // in-band error and then reports the upstream failure.
  emit(event: BridgeStreamEvent): void {
    if (event.responseID !== "" && this.state.id === "") {
      this.state.id = event.responseID;
    }
    if (event.model !== "") {
      this.state.model = event.model;
    }
    if (!this.started && this.opensResponse(event)) {
      this.start();
    }
    switch (event.kind) {
      case "reasoning":
        this.emitReasoning(event);
        return;
      case "reasoning_signature":
        if (event.signature === "") {
          return;
        }
        this.state.reasoningSignature += event.signature;
        this.writer.emitReasoningSignature(event.signature);
        return;
      case "text":
        if (event.text === "") {
          return;
        }
        this.state.text += event.text;
        this.writer.emitText(event.text);
        return;
      case "tool_start": {
        const tool = this.tool(event.toolKey);
        this.applyToolIdentity(tool, event);
        this.startTool(tool);
        this.emitPendingToolArguments(tool);
        return;
      }
      case "tool_delta": {
        const tool = this.tool(event.toolKey);
        this.applyToolIdentity(tool, event);
        tool.arguments += event.text;
        this.startTool(tool);
        this.emitPendingToolArguments(tool);
        return;
      }
      case "usage":
        if (event.usage !== undefined) {
          this.usageSeen = true;
          this.state.usage = mergeBridgeUsage(this.state.usage, event.usage);
        }
        return;
      case "finish":
        this.state.stop = event.stop;
        return;
      case "error":
        this.done = true;
        this.writer.emitError(
          firstString(event.error, "upstream stream failed"),
          firstString(event.errorType, "upstream_error"),
        );
        throw errStreamUpstreamFailure;
      case "done":
        this.finish();
        return;
      default:
        return;
    }
  }

  // opensResponse reports whether an event should open the response. The
  // response stays closed for a stream that only reports usage or a stop.
  private opensResponse(event: BridgeStreamEvent): boolean {
    switch (event.kind) {
      case "start":
      case "reasoning":
      case "reasoning_signature":
      case "text":
      case "tool_start":
      case "tool_delta":
        return true;
      default:
        return false;
    }
  }

  private emitReasoning(event: BridgeStreamEvent): void {
    let text = event.text;
    if (event.encrypted !== "") {
      this.state.reasoningEncrypted = event.encrypted;
      if (text === "") {
        text = ANTHROPIC_REDACTED_THINKING_PLACEHOLDER;
      }
    }
    if (text === "") {
      return;
    }
    this.state.reasoning += text;
    this.writer.emitReasoning(text);
  }

  private applyToolIdentity(tool: StreamTool, event: BridgeStreamEvent): void {
    if (event.toolID !== "") {
      tool.id = event.toolID;
    }
    if (event.toolName !== "") {
      tool.name = event.toolName;
    }
  }

  // tool returns the state for a stream tool key, creating it with fresh IDs
  // and the next index on first sight. An empty key gets a position-based one,
  // so each unnamed event starts its own tool.
  private tool(key: string): StreamTool {
    const resolved = key === "" ? `tool-${this.order.length}` : key;
    const existing = this.tools.get(resolved);
    if (existing !== undefined) {
      return existing;
    }
    const tool: StreamTool = {
      key: resolved,
      id: randomID("call", 12),
      itemID: randomID("fc", 12),
      name: "",
      arguments: "",
      index: this.order.length,
      anthropicIndex: 0,
      started: false,
      emittedArguments: 0,
    };
    this.tools.set(resolved, tool);
    this.order = [...this.order, resolved];
    return tool;
  }

  // startTool opens a tool call downstream once its name is non-empty, closing
  // the reasoning block first. A tool with no name stays unstarted, so a
  // phantom call is never announced.
  private startTool(tool: StreamTool): void {
    if (tool.started || tool.name === "") {
      return;
    }
    tool.started = true;
    this.writer.startTool(tool);
  }

  // emitPendingToolArguments writes the argument text a tool has accumulated
  // but not yet sent. A tool that has not started holds its arguments until it
  // does, so nothing is lost when the name arrives late.
  private emitPendingToolArguments(tool: StreamTool): void {
    if (!tool.started) {
      return;
    }
    const encoder = new TextEncoder();
    const bytes = encoder.encode(tool.arguments);
    if (tool.emittedArguments >= bytes.length) {
      return;
    }
    const decoder = new TextDecoder();
    const delta = decoder.decode(
      bytes.slice(tool.emittedArguments),
      { stream: true },
    );
    tool.emittedArguments = bytes.length;
    this.writer.emitToolDelta(tool, delta);
  }

  // anyToolStarted reports whether at least one tool block was actually opened
  // downstream. A tool stuck without a name never starts, so its stop promise
  // must not be advertised as a tool stop.
  private anyToolStarted(): boolean {
    return this.order.some((key) => this.tools.get(key)?.started === true);
  }

  // finish closes the response in the target protocol's shape. The stop reason
  // defaults to "tool_calls" when any tool call was seen and "stop" otherwise,
  // and a tool stop with no started tool is demoted to "stop" so the client
  // does not wait for a call it never received.
  finish(): void {
    if (this.done) {
      return;
    }
    this.done = true;
    if (!this.started) {
      this.start();
    }
    if (this.state.stop === "") {
      this.state.stop = this.order.length > 0 ? "tool_calls" : "stop";
    }
    if (isToolStop(this.state.stop) && !this.anyToolStarted()) {
      this.state.stop = "stop";
    }
    this.state.tools = this.order
      .map((key) => this.tools.get(key))
      .filter((tool): tool is StreamTool => tool !== undefined);
    this.writer.finish(this.state);
  }

  private start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    if (this.state.id === "") {
      this.state.id = randomID("resp", 12);
    }
    this.writer.start();
  }
}
