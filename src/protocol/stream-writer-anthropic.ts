import { asPrefix } from "./identity.js";
import { anthropicStop, anthropicUsage } from "./response-usage.js";
import {
  SSEWriter,
  type StreamState,
  type StreamTool,
  type StreamWriter,
} from "./stream-writer.js";

// AnthropicWriter encodes an Anthropic message stream. Its content blocks are
// sequential, so the reasoning block is closed before a text or tool block
// opens.
export class AnthropicWriter implements StreamWriter {
  private readonly sse: SSEWriter;
  private readonly state: StreamState;
  private textOpen = false;
  private textIndex = 0;
  private nextAnthropic = 0;
  private reasoningOpen = false;
  private reasoningClosed = false;
  private reasoningIndex = 0;

  constructor(sse: SSEWriter, state: StreamState) {
    this.sse = sse;
    this.state = state;
  }

  start(): void {
    this.sse.sse("message_start", {
      type: "message_start",
      message: {
        id: asPrefix(this.state.id, "msg"),
        type: "message",
        role: "assistant",
        model: this.state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: anthropicUsage({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
          reasoningTokens: 0,
        }),
      },
    });
  }

  emitText(text: string): void {
    this.finishReasoning();
    if (!this.textOpen) {
      this.textOpen = true;
      this.textIndex = this.nextAnthropic;
      this.nextAnthropic += 1;
      this.sse.sse("content_block_start", {
        type: "content_block_start",
        index: this.textIndex,
        content_block: { type: "text", text: "" },
      });
    }
    this.sse.sse("content_block_delta", {
      type: "content_block_delta",
      index: this.textIndex,
      delta: { type: "text_delta", text },
    });
  }

  emitReasoning(text: string): void {
    this.startReasoning();
    this.sse.sse("content_block_delta", {
      type: "content_block_delta",
      index: this.reasoningIndex,
      delta: { type: "thinking_delta", thinking: text },
    });
  }

  emitReasoningSignature(signature: string): void {
    this.startReasoning();
    this.sse.sse("content_block_delta", {
      type: "content_block_delta",
      index: this.reasoningIndex,
      delta: { type: "signature_delta", signature },
    });
  }

  startTool(tool: StreamTool): void {
    this.finishReasoning();
    if (this.textOpen) {
      this.sse.sse("content_block_stop", {
        type: "content_block_stop",
        index: this.textIndex,
      });
      this.textOpen = false;
    }
    tool.anthropicIndex = this.nextAnthropic;
    this.nextAnthropic += 1;
    this.sse.sse("content_block_start", {
      type: "content_block_start",
      index: tool.anthropicIndex,
      content_block: {
        type: "tool_use",
        id: tool.id,
        name: tool.name,
        input: {},
      },
    });
  }

  emitToolDelta(tool: StreamTool, delta: string): void {
    this.sse.sse("content_block_delta", {
      type: "content_block_delta",
      index: tool.anthropicIndex,
      delta: { type: "input_json_delta", partial_json: delta },
    });
  }

  emitError(message: string, errorType: string): void {
    this.sse.sse("error", {
      type: "error",
      error: { type: errorType, message },
    });
  }

  finish(state: StreamState): void {
    this.finishReasoning();
    if (this.textOpen) {
      this.sse.sse("content_block_stop", {
        type: "content_block_stop",
        index: this.textIndex,
      });
      this.textOpen = false;
    }
    for (const tool of state.tools) {
      if (tool.started) {
        this.sse.sse("content_block_stop", {
          type: "content_block_stop",
          index: tool.anthropicIndex,
        });
      }
    }
    this.sse.sse("message_delta", {
      type: "message_delta",
      delta: { stop_reason: anthropicStop(state.stop), stop_sequence: null },
      usage: anthropicUsage(state.usage),
    });
    this.sse.sse("message_stop", { type: "message_stop" });
  }

  private startReasoning(): void {
    if (this.reasoningOpen || this.reasoningClosed) {
      return;
    }
    this.reasoningOpen = true;
    this.reasoningIndex = this.nextAnthropic;
    this.nextAnthropic += 1;
    this.sse.sse("content_block_start", {
      type: "content_block_start",
      index: this.reasoningIndex,
      content_block: { type: "thinking", thinking: "", signature: "" },
    });
  }

  private finishReasoning(): void {
    if (!this.reasoningOpen || this.reasoningClosed) {
      return;
    }
    this.reasoningClosed = true;
    this.sse.sse("content_block_stop", {
      type: "content_block_stop",
      index: this.reasoningIndex,
    });
  }
}
