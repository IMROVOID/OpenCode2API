import type { BridgeBlock, BridgeResponse, Usage } from "../types/inference.js";
import type { Protocol } from "../types/config.js";
import { emptyBlock } from "./block.js";
import { encodeBridgeResponse } from "./response-encode.js";
import { SSEReader } from "./sse.js";
import { StreamParser } from "./stream-parser.js";
import { mergeBridgeUsage } from "./stream-writer.js";
import {
  errSSEUnexpectedEOF,
  type BridgeStreamEvent,
} from "./stream-types.js";

// collapseStream consumes one complete upstream SSE stream and synthesizes the
// equivalent single (non-streaming) response document in the same protocol.
//
// It exists for upstream lanes that only serve streaming responses: the
// gateway forces stream:true on the wire and collapses the events back so
// downstream clients that asked for a plain JSON reply keep working. model is
// the response's model name unless the stream's start event names one. A
// stream that reports an error, cannot be parsed or ends without a terminal
// event is an error.
export async function collapseStream(
  source: AsyncIterable<Uint8Array>,
  protocol: Protocol,
  model: string,
): Promise<string> {
  const parser = new StreamParser(protocol);
  const accumulator = new CollapseAccumulator(model);
  const reader = new SSEReader();
  let terminated = false;
  let streamError: Error | undefined;

  for await (const chunk of source) {
    for (const record of reader.push(chunk)) {
      const outcome = consumeRecord(
        parser,
        accumulator,
        record.event,
        record.data,
      );
      if (outcome.stop) {
        terminated = true;
        break;
      }
      if (outcome.error !== undefined) {
        streamError = outcome.error;
        break;
      }
    }
    if (terminated || streamError !== undefined) {
      break;
    }
  }

  if (streamError !== undefined) {
    throw streamError;
  }
  if (!terminated) {
    // A record that was never terminated by a blank line is a truncated
    // stream, and so is a stream that ended without a terminal event.
    reader.close();
    throw errSSEUnexpectedEOF;
  }
  const response = accumulator.response();
  return JSON.stringify(encodeBridgeResponse(protocol, response));
}

// consumeRecord parses one SSE record and folds its events into the
// accumulator. A done event stops the read, an error event fails it.
function consumeRecord(
  parser: StreamParser,
  accumulator: CollapseAccumulator,
  eventName: string,
  data: string,
): { stop: boolean; error: Error | undefined } {
  let events: BridgeStreamEvent[];
  try {
    events = parser.parse(eventName, data);
  } catch (error) {
    return { stop: false, error: asError(error) };
  }
  for (const event of events) {
    if (event.kind === "done") {
      return { stop: true, error: undefined };
    }
    if (event.kind === "error") {
      const message =
        event.error !== "" ? event.error : "upstream stream failed";
      return { stop: false, error: new Error(message) };
    }
    accumulator.apply(event);
  }
  return { stop: false, error: undefined };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// CollapseAccumulator folds bridge stream events into one bridge response.
// It keeps the index of each tool call and the reasoning block that deltas
// currently accumulate into.
export class CollapseAccumulator {
  private text = "";
  private readonly reasoning: BridgeBlock[] = [];
  private readonly tools: BridgeBlock[] = [];
  private readonly toolIndex = new Map<string, number>();
  private openReasoning: number | undefined;
  private id = "";
  private model: string;
  private stop = "";
  private usage: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
  };
  private readonly created: number;

  constructor(model: string) {
    this.model = model;
    this.created = Math.floor(Date.now() / 1000);
  }

  // apply folds one stream event into the response. Reasoning text and
  // signatures accumulate into the open reasoning block, while encrypted
  // reasoning is stored in a block of its own that is closed at once.
  apply(event: BridgeStreamEvent): void {
    switch (event.kind) {
      case "start":
        if (event.responseID !== "") {
          this.id = event.responseID;
        }
        if (event.model !== "") {
          this.model = event.model;
        }
        return;
      case "text":
        this.text += event.text;
        return;
      case "reasoning": {
        if (
          event.text === "" &&
          event.encrypted === "" &&
          event.signature === ""
        ) {
          return;
        }
        const block = this.openReasoningBlock();
        block.text += event.text;
        if (event.encrypted !== "") {
          this.closeReasoning();
          const encrypted = this.openReasoningBlock();
          encrypted.encrypted += event.encrypted;
          this.closeReasoning();
        }
        return;
      }
      case "reasoning_signature": {
        const block = this.openReasoningBlock();
        block.signature += event.signature;
        return;
      }
      case "tool_start":
        this.toolBlock(event.toolKey, event.toolID, event.toolName);
        return;
      case "tool_delta": {
        const block = this.toolBlock(event.toolKey, event.toolID, event.toolName);
        block.argumentsJSON += event.text;
        return;
      }
      case "usage":
        if (event.usage !== undefined) {
          this.usage = mergeBridgeUsage(this.usage, event.usage);
        }
        return;
      case "finish":
        this.stop = event.stop;
        return;
      default:
        return;
    }
  }

  // openReasoningBlock returns the reasoning block that deltas accumulate
  // into, appending a new one when none is open: before the first reasoning
  // event, and after an encrypted event closed the previous block.
  private openReasoningBlock(): BridgeBlock {
    if (this.openReasoning === undefined) {
      this.reasoning.push(emptyBlock("reasoning"));
      this.openReasoning = this.reasoning.length - 1;
    }
    const block = this.reasoning[this.openReasoning];
    if (block === undefined) {
      throw new Error("collapse accumulator lost its reasoning block");
    }
    return block;
  }

  // closeReasoning closes the open reasoning block, so the next reasoning
  // delta starts a new one.
  private closeReasoning(): void {
    this.openReasoning = undefined;
  }

  // toolBlock returns the tool call for a stream tool key, appending it on
  // first sight and filling in an ID or name that earlier events lacked.
  private toolBlock(key: string, id: string, name: string): BridgeBlock {
    const index = this.toolIndex.get(key);
    if (index !== undefined) {
      const block = this.tools[index];
      if (block === undefined) {
        throw new Error("collapse accumulator lost its tool block");
      }
      if (block.id === "") {
        block.id = id;
      }
      if (block.name === "") {
        block.name = name;
      }
      return block;
    }
    const block = emptyBlock("tool_call");
    block.id = id;
    block.name = name;
    this.tools.push(block);
    this.toolIndex.set(key, this.tools.length - 1);
    return block;
  }

  response(): BridgeResponse {
    return {
      id: this.id,
      model: this.model,
      text: this.text,
      reasoning: [...this.reasoning],
      tools: [...this.tools],
      stop: this.stop,
      error: "",
      usage: this.usage,
      created: this.created,
    };
  }
}
