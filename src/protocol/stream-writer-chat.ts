import { asPrefix } from "./identity.js";
import { chatStop, openAIUsage } from "./response-usage.js";
import {
  SSEWriter,
  type StreamState,
  type StreamTool,
  type StreamWriter,
} from "./stream-writer.js";

// ChatWriter encodes a Chat completion chunk stream.
export class ChatWriter implements StreamWriter {
  private readonly sse: SSEWriter;
  private readonly state: StreamState;
  private readonly created: number;

  constructor(sse: SSEWriter, state: StreamState, created: number) {
    this.sse = sse;
    this.state = state;
    this.created = created;
  }

  start(): void {
    this.chunk({ role: "assistant", content: "" }, null);
  }

  emitText(text: string): void {
    this.chunk({ content: text }, null);
  }

  emitReasoning(text: string): void {
    this.chunk({ reasoning_content: text }, null);
  }

  emitReasoningSignature(signature: string): void {
    this.chunk({ reasoning_signature: signature }, null);
  }

  startTool(tool: StreamTool): void {
    this.chunk(
      {
        tool_calls: [
          {
            index: tool.index,
            id: tool.id,
            type: "function",
            function: { name: tool.name, arguments: "" },
          },
        ],
      },
      null,
    );
  }

  emitToolDelta(tool: StreamTool, delta: string): void {
    this.chunk(
      {
        tool_calls: [
          {
            index: tool.index,
            function: { arguments: delta },
          },
        ],
      },
      null,
    );
  }

  emitError(message: string, errorType: string): void {
    this.sse.sse("", {
      error: { message, type: errorType, param: null, code: null },
    });
    this.sse.rawSSE("", "[DONE]");
  }

  finish(state: StreamState): void {
    this.chunk({}, chatStop(state.stop));
    this.sse.sse("", {
      id: asPrefix(state.id, "chatcmpl"),
      object: "chat.completion.chunk",
      created: state.created,
      model: state.model,
      choices: [],
      usage: openAIUsage(state.usage),
    });
    this.sse.rawSSE("", "[DONE]");
  }

  private chunk(delta: Record<string, unknown>, finish: unknown): void {
    this.sse.sse("", {
      id: asPrefix(this.state.id, "chatcmpl"),
      object: "chat.completion.chunk",
      created: this.created,
      model: this.state.model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finish,
        },
      ],
    });
  }
}
