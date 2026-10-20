import { asPrefix, randomID } from "./identity.js";
import { encodeBridgeResponse } from "./response-encode.js";
import type { BridgeBlock } from "../types/inference.js";
import {
  SSEWriter,
  type StreamState,
  type StreamTool,
  type StreamWriter,
} from "./stream-writer.js";

// ResponsesWriter encodes a Responses stream. Its output items are sequential,
// so the reasoning item is closed before a message or tool item opens.
export class ResponsesWriter implements StreamWriter {
  private readonly sse: SSEWriter;
  private readonly state: StreamState;
  private readonly created: number;
  private sequence = 0;
  private nextOutput = 0;
  private textOpen = false;
  private textItemID = "";
  private textOutput = 0;
  private reasoningOpen = false;
  private reasoningClosed = false;
  private reasoningItemID = "";
  private reasoningOutput = 0;
  private reasoningText = "";

  constructor(sse: SSEWriter, state: StreamState, created: number) {
    this.sse = sse;
    this.state = state;
    this.created = created;
  }

  start(): void {
    const response = this.responsesBase("in_progress", []);
    this.sse.sse("response.created", {
      type: "response.created",
      response,
      sequence_number: this.nextSequence(),
    });
    this.sse.sse("response.in_progress", {
      type: "response.in_progress",
      response,
      sequence_number: this.nextSequence(),
    });
  }

  emitText(text: string): void {
    this.finishReasoning();
    if (!this.textOpen) {
      this.textOpen = true;
      this.textItemID = randomID("msg", 12);
      this.textOutput = this.nextOutput;
      this.nextOutput += 1;
      this.sse.sse("response.output_item.added", {
        type: "response.output_item.added",
        output_index: this.textOutput,
        item: {
          id: this.textItemID,
          type: "message",
          status: "in_progress",
          role: "assistant",
          content: [],
        },
        sequence_number: this.nextSequence(),
      });
      this.sse.sse("response.content_part.added", {
        type: "response.content_part.added",
        item_id: this.textItemID,
        output_index: this.textOutput,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
        sequence_number: this.nextSequence(),
      });
    }
    this.sse.sse("response.output_text.delta", {
      type: "response.output_text.delta",
      delta: text,
      item_id: this.textItemID,
      output_index: this.textOutput,
      content_index: 0,
      sequence_number: this.nextSequence(),
    });
  }

  emitReasoning(text: string): void {
    this.startReasoning();
    this.reasoningText += text;
    this.sse.sse("response.reasoning_summary_text.delta", {
      type: "response.reasoning_summary_text.delta",
      delta: text,
      item_id: this.reasoningItemID,
      output_index: this.reasoningOutput,
      summary_index: 0,
      sequence_number: this.nextSequence(),
    });
  }

  emitReasoningSignature(_signature: string): void {
    // Responses has no field for a reasoning signature, so it is dropped.
  }

  startTool(tool: StreamTool): void {
    this.finishReasoning();
    tool.index = this.nextOutput;
    this.nextOutput += 1;
    this.sse.sse("response.output_item.added", {
      type: "response.output_item.added",
      output_index: tool.index,
      item: {
        id: tool.itemID,
        type: "function_call",
        status: "in_progress",
        arguments: "",
        call_id: tool.id,
        name: tool.name,
      },
      sequence_number: this.nextSequence(),
    });
  }

  emitToolDelta(tool: StreamTool, delta: string): void {
    this.sse.sse("response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta",
      delta,
      item_id: tool.itemID,
      output_index: tool.index,
      sequence_number: this.nextSequence(),
    });
  }

  emitError(message: string, errorType: string): void {
    const response = this.responsesBase("failed", []);
    response["error"] = { code: errorType, message };
    this.sse.sse("response.failed", {
      type: "response.failed",
      response,
      sequence_number: this.nextSequence(),
    });
  }

  finish(state: StreamState): void {
    this.finishReasoning();
    this.finishText(state.text);
    for (const tool of state.tools) {
      const args = tool.arguments === "" ? "{}" : tool.arguments;
      this.sse.sse("response.function_call_arguments.done", {
        type: "response.function_call_arguments.done",
        arguments: args,
        item_id: tool.itemID,
        output_index: tool.index,
        sequence_number: this.nextSequence(),
      });
      this.sse.sse("response.output_item.done", {
        type: "response.output_item.done",
        output_index: tool.index,
        item: {
          id: tool.itemID,
          type: "function_call",
          status: "completed",
          arguments: args,
          call_id: tool.id,
          name: tool.name,
        },
        sequence_number: this.nextSequence(),
      });
    }
    const completed = encodeBridgeResponse("responses", {
      id: state.id,
      model: state.model,
      text: state.text,
      reasoning: this.reasoningBlocks(state),
      tools: state.tools.map((tool) => this.toolBlock(tool)),
      stop: state.stop,
      error: "",
      usage: state.usage,
      created: state.created,
    });
    this.sse.sse("response.completed", {
      type: "response.completed",
      response: completed,
      sequence_number: this.nextSequence(),
    });
  }

  private reasoningBlocks(state: StreamState): BridgeBlock[] {
    if (state.reasoning === "" && state.reasoningSignature === "") {
      return [];
    }
    const block = emptyBlock("reasoning");
    block.id = this.reasoningItemID;
    block.text = state.reasoning;
    block.signature = state.reasoningSignature;
    return [block];
  }

  private toolBlock(tool: StreamTool): BridgeBlock {
    const block = emptyBlock("tool_call");
    block.id = tool.id;
    block.name = tool.name;
    block.argumentsJSON = tool.arguments;
    return block;
  }

  private finishText(text: string): void {
    if (!this.textOpen) {
      return;
    }
    this.textOpen = false;
    this.sse.sse("response.output_text.done", {
      type: "response.output_text.done",
      text,
      item_id: this.textItemID,
      output_index: this.textOutput,
      content_index: 0,
      sequence_number: this.nextSequence(),
    });
    const part = { type: "output_text", text, annotations: [] };
    this.sse.sse("response.content_part.done", {
      type: "response.content_part.done",
      item_id: this.textItemID,
      output_index: this.textOutput,
      content_index: 0,
      part,
      sequence_number: this.nextSequence(),
    });
    this.sse.sse("response.output_item.done", {
      type: "response.output_item.done",
      output_index: this.textOutput,
      item: {
        id: this.textItemID,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [part],
      },
      sequence_number: this.nextSequence(),
    });
  }

  private startReasoning(): void {
    if (this.reasoningOpen || this.reasoningClosed) {
      return;
    }
    this.reasoningOpen = true;
    this.reasoningItemID = randomID("rs", 12);
    this.reasoningOutput = this.nextOutput;
    this.nextOutput += 1;
    this.sse.sse("response.output_item.added", {
      type: "response.output_item.added",
      output_index: this.reasoningOutput,
      item: {
        id: this.reasoningItemID,
        type: "reasoning",
        status: "in_progress",
        summary: [],
      },
      sequence_number: this.nextSequence(),
    });
    this.sse.sse("response.reasoning_summary_part.added", {
      type: "response.reasoning_summary_part.added",
      item_id: this.reasoningItemID,
      output_index: this.reasoningOutput,
      summary_index: 0,
      part: { type: "summary_text", text: "" },
      sequence_number: this.nextSequence(),
    });
  }

  private finishReasoning(): void {
    if (!this.reasoningOpen || this.reasoningClosed) {
      return;
    }
    this.reasoningClosed = true;
    this.sse.sse("response.reasoning_summary_text.done", {
      type: "response.reasoning_summary_text.done",
      text: this.reasoningText,
      item_id: this.reasoningItemID,
      output_index: this.reasoningOutput,
      summary_index: 0,
      sequence_number: this.nextSequence(),
    });
    const part = { type: "summary_text", text: this.reasoningText };
    this.sse.sse("response.reasoning_summary_part.done", {
      type: "response.reasoning_summary_part.done",
      item_id: this.reasoningItemID,
      output_index: this.reasoningOutput,
      summary_index: 0,
      part,
      sequence_number: this.nextSequence(),
    });
    this.sse.sse("response.output_item.done", {
      type: "response.output_item.done",
      output_index: this.reasoningOutput,
      item: {
        id: this.reasoningItemID,
        type: "reasoning",
        status: "completed",
        summary: [part],
      },
      sequence_number: this.nextSequence(),
    });
  }

  private responsesBase(
    status: string,
    output: unknown[],
  ): Record<string, unknown> {
    return {
      id: asPrefix(this.state.id, "resp"),
      object: "response",
      created_at: this.created,
      status,
      model: this.state.model,
      output,
      error: null,
    };
  }

  private nextSequence(): number {
    const sequence = this.sequence;
    this.sequence += 1;
    return sequence;
  }
}

// emptyBlock builds a blank block of the given kind for the closing document.
function emptyBlock(kind: BridgeBlock["kind"]): BridgeBlock {
  return {
    kind,
    text: "",
    signature: "",
    encrypted: "",
    url: "",
    mediaType: "",
    data: "",
    fileId: "",
    filename: "",
    id: "",
    name: "",
    arguments: undefined,
    argumentsJSON: "",
    callId: "",
    result: undefined,
    isError: false,
  };
}
