import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StreamParser } from "../src/protocol/stream-parser.js";
import { StreamCodec } from "../src/protocol/stream-encoder.js";
import { SSEReader } from "../src/protocol/sse.js";
import { collapseStream } from "../src/protocol/collapse.js";
import {
  errStreamUpstreamFailure,
  type BridgeStreamEvent,
  type StreamSink,
} from "../src/protocol/stream-types.js";

// A sink that collects the bytes written to it.
class CollectingSink implements StreamSink {
  readonly chunks: Uint8Array[] = [];

  write(chunk: Uint8Array): void {
    this.chunks.push(chunk);
  }

  text(): string {
    return new TextDecoder().decode(Buffer.concat(this.chunks));
  }
}

// The events a parse produced.
function kinds(events: BridgeStreamEvent[]): string[] {
  return events.map((event) => event.kind);
}

describe("SSEReader", () => {
  it("reads a record that ends on a blank line", () => {
    // Arrange
    const reader = new SSEReader();
    // Act
    const records = reader.push(new TextEncoder().encode("data: hello\n\n"));
    // Assert
    assert.equal(records.length, 1);
    assert.equal(records[0]?.data, "hello");
  });

  it("joins several data lines with a newline", () => {
    // Arrange
    const reader = new SSEReader();
    // Act
    const records = reader.push(new TextEncoder().encode("data: a\ndata: b\n\n"));
    // Assert
    assert.equal(records[0]?.data, "a\nb");
  });

  it("skips a comment line", () => {
    // Arrange
    const reader = new SSEReader();
    // Act
    const records = reader.push(new TextEncoder().encode(": keepalive\ndata: x\n\n"));
    // Assert
    assert.equal(records.length, 1);
    assert.equal(records[0]?.data, "x");
  });

  it("drops a record that never ended", () => {
    // Arrange
    const reader = new SSEReader();
    // Act
    reader.push(new TextEncoder().encode("data: x\n"));
    const tail = reader.close();
    // Assert
    assert.equal(tail.records.length, 0);
    assert.equal(tail.truncated, true);
  });

  it("reads the event name of a record", () => {
    // Arrange
    const reader = new SSEReader();
    // Act
    const records = reader.push(
      new TextEncoder().encode("event: message_start\ndata: {}\n\n"),
    );
    // Assert
    assert.equal(records[0]?.event, "message_start");
  });
});

describe("StreamParser (chat)", () => {
  it("emits a start event for the first chunk with an id", () => {
    // Arrange
    const parser = new StreamParser("chat");
    // Act
    const events = parser.parse(
      "",
      JSON.stringify({ id: "chatcmpl_1", model: "m", choices: [] }),
    );
    // Assert
    assert.deepEqual(kinds(events), ["start"]);
    assert.equal(events[0]?.responseID, "chatcmpl_1");
  });

  it("emits a text event for a content delta", () => {
    // Arrange
    const parser = new StreamParser("chat");
    // Act
    const events = parser.parse(
      "",
      JSON.stringify({ choices: [{ delta: { content: "hi" } }] }),
    );
    // Assert
    assert.deepEqual(kinds(events), ["text"]);
    assert.equal(events[0]?.text, "hi");
  });

  it("emits a usage event when the chunk carries a usage object", () => {
    // Arrange
    const parser = new StreamParser("chat");
    // Act
    const events = parser.parse(
      "",
      JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } }),
    );
    // Assert
    assert.deepEqual(kinds(events), ["usage"]);
    assert.equal(events[0]?.usage?.inputTokens, 3);
  });

  it("emits a done event for the [DONE] terminator", () => {
    // Arrange
    const parser = new StreamParser("chat");
    // Act
    const events = parser.parse("", "[DONE]");
    // Assert
    assert.deepEqual(kinds(events), ["done"]);
  });

  it("rejects the [DONE] terminator on a responses stream", () => {
    // Arrange
    const parser = new StreamParser("responses");
    // Act
    assert.throws(() => parser.parse("", "[DONE]"), /unexpected \[DONE\]/);
  });

  it("emits an error event for an error key", () => {
    // Arrange
    const parser = new StreamParser("chat");
    // Act
    const events = parser.parse("", JSON.stringify({ error: { message: "bad" } }));
    // Assert
    assert.deepEqual(kinds(events), ["error"]);
    assert.equal(events[0]?.error, "bad");
  });

  it("emits a tool start once the arguments and the name arrived", () => {
    // Arrange
    const parser = new StreamParser("chat");
    // Act
    const events = parser.parse(
      "",
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", function: { name: "read", arguments: "{}" } },
              ],
            },
          },
        ],
      }),
    );
    // Assert
    assert.deepEqual(kinds(events), ["tool_start", "tool_delta"]);
    assert.equal(events[0]?.toolName, "read");
  });
});

describe("StreamParser (anthropic)", () => {
  it("emits a start and a usage event for a message_start", () => {
    // Arrange
    const parser = new StreamParser("anthropic");
    // Act
    const events = parser.parse(
      "message_start",
      JSON.stringify({
        type: "message_start",
        message: { id: "msg_1", model: "m", usage: { input_tokens: 5 } },
      }),
    );
    // Assert
    assert.deepEqual(kinds(events), ["start", "usage"]);
  });

  it("emits a text event for a text delta", () => {
    // Arrange
    const parser = new StreamParser("anthropic");
    // Act
    const events = parser.parse(
      "content_block_delta",
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "hello" },
      }),
    );
    // Assert
    assert.deepEqual(kinds(events), ["text"]);
  });

  it("emits a done event for a message_stop", () => {
    // Arrange
    const parser = new StreamParser("anthropic");
    // Act
    const events = parser.parse("message_stop", JSON.stringify({ type: "message_stop" }));
    // Assert
    assert.deepEqual(kinds(events), ["done"]);
  });
});

describe("StreamParser (responses)", () => {
  it("emits a start event for a response.created", () => {
    // Arrange
    const parser = new StreamParser("responses");
    // Act
    const events = parser.parse(
      "response.created",
      JSON.stringify({
        type: "response.created",
        response: { id: "resp_1", model: "m" },
      }),
    );
    // Assert
    assert.deepEqual(kinds(events), ["start"]);
  });

  it("emits a text event for an output text delta", () => {
    // Arrange
    const parser = new StreamParser("responses");
    // Act
    const events = parser.parse(
      "response.output_text.delta",
      JSON.stringify({ type: "response.output_text.delta", delta: "hi" }),
    );
    // Assert
    assert.deepEqual(kinds(events), ["text"]);
  });

  it("emits a finish and a done event for a completed response", () => {
    // Arrange
    const parser = new StreamParser("responses");
    // Act
    const events = parser.parse(
      "response.completed",
      JSON.stringify({
        type: "response.completed",
        response: { id: "resp_1", output: [], usage: { input_tokens: 1 } },
      }),
    );
    // Assert
    assert.deepEqual(kinds(events), ["usage", "finish", "done"]);
    assert.equal(events[1]?.stop, "stop");
  });

  it("emits a tool_calls stop when the output holds a function call", () => {
    // Arrange
    const parser = new StreamParser("responses");
    // Act
    const events = parser.parse(
      "response.completed",
      JSON.stringify({
        type: "response.completed",
        response: { id: "resp_1", output: [{ type: "function_call" }] },
      }),
    );
    // Assert
    assert.deepEqual(kinds(events), ["finish", "done"]);
    assert.equal(events[0]?.stop, "tool_calls");
  });
});

describe("StreamCodec (chat)", () => {
  it("writes a role chunk, a finish chunk and the [DONE] terminator", () => {
    // Arrange
    const sink = new CollectingSink();
    const codec = new StreamCodec(sink, "chat", "m");
    // Act
    codec.emit({
      kind: "start",
      responseID: "chatcmpl_1",
      model: "m",
      text: "",
      signature: "",
      toolKey: "",
      toolID: "",
      toolName: "",
      stop: "",
      error: "",
      errorType: "",
      encrypted: "",
      usage: undefined,
    });
    codec.emit({
      kind: "text",
      responseID: "",
      model: "",
      text: "hi",
      signature: "",
      toolKey: "",
      toolID: "",
      toolName: "",
      stop: "",
      error: "",
      errorType: "",
      encrypted: "",
      usage: undefined,
    });
    codec.finish();
    // Assert
    const output = sink.text();
    assert.match(output, /"role":"assistant"/);
    assert.match(output, /"content":"hi"/);
    assert.match(output, /data: \[DONE\]/);
  });
});

describe("StreamCodec (anthropic)", () => {
  it("writes a message_start, the content blocks and a message_stop", () => {
    // Arrange
    const sink = new CollectingSink();
    const codec = new StreamCodec(sink, "anthropic", "m");
    // Act
    codec.emit({
      kind: "text",
      responseID: "",
      model: "",
      text: "hi",
      signature: "",
      toolKey: "",
      toolID: "",
      toolName: "",
      stop: "",
      error: "",
      errorType: "",
      encrypted: "",
      usage: undefined,
    });
    codec.finish();
    // Assert
    const output = sink.text();
    assert.match(output, /event: message_start/);
    assert.match(output, /event: content_block_start/);
    assert.match(output, /event: content_block_delta/);
    assert.match(output, /event: message_stop/);
  });

  it("carries the response id into the message_start", () => {
    // Arrange
    const sink = new CollectingSink();
    const codec = new StreamCodec(sink, "anthropic", "m");
    // Act
    codec.emit({
      kind: "start",
      responseID: "chatcmpl_abc",
      model: "m",
      text: "",
      signature: "",
      toolKey: "",
      toolID: "",
      toolName: "",
      stop: "",
      error: "",
      errorType: "",
      encrypted: "",
      usage: undefined,
    });
    codec.finish();
    // Assert
    assert.match(sink.text(), /"id":"msg_abc"/);
  });
});

describe("StreamCodec (responses)", () => {
  it("writes a response.created and a response.completed", () => {
    // Arrange
    const sink = new CollectingSink();
    const codec = new StreamCodec(sink, "responses", "m");
    // Act
    codec.emit({
      kind: "text",
      responseID: "",
      model: "",
      text: "hi",
      signature: "",
      toolKey: "",
      toolID: "",
      toolName: "",
      stop: "",
      error: "",
      errorType: "",
      encrypted: "",
      usage: undefined,
    });
    codec.finish();
    // Assert
    const output = sink.text();
    assert.match(output, /event: response.created/);
    assert.match(output, /event: response.output_text.delta/);
    assert.match(output, /event: response.completed/);
    assert.equal(output.includes("[DONE]"), false);
  });
});

describe("StreamCodec errors", () => {
  it("throws the upstream failure sentinel on an error event", () => {
    // Arrange
    const sink = new CollectingSink();
    const codec = new StreamCodec(sink, "chat", "m");
    // Act and assert
    assert.throws(
      () =>
        codec.emit({
          kind: "error",
          responseID: "",
          model: "",
          text: "",
          signature: "",
          toolKey: "",
          toolID: "",
          toolName: "",
          stop: "",
          error: "boom",
          errorType: "upstream_error",
          encrypted: "",
          usage: undefined,
        }),
      (error: unknown) => error === errStreamUpstreamFailure,
    );
  });

  it("writes an in-band error event before throwing", () => {
    // Arrange
    const sink = new CollectingSink();
    const codec = new StreamCodec(sink, "chat", "m");
    // Act
    try {
      codec.emit({
        kind: "error",
        responseID: "",
        model: "",
        text: "",
        signature: "",
        toolKey: "",
        toolID: "",
        toolName: "",
        stop: "",
        error: "boom",
        errorType: "upstream_error",
        encrypted: "",
        usage: undefined,
      });
    } catch {
      // The throw is asserted in the other test.
    }
    // Assert
    assert.match(sink.text(), /"message":"boom"/);
  });
});

describe("collapseStream", () => {
  it("collapses a chat stream into one document", async () => {
    // Arrange
    const source = [
      'data: {"id":"chatcmpl_1","model":"m","choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    // Act
    const body = await collapseStream(
      { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(source); } },
      "chat",
      "m",
    );
    // Assert
    const parsed = JSON.parse(body) as Record<string, unknown>;
    assert.equal(parsed["object"], "chat.completion");
    const choices = parsed["choices"] as Record<string, unknown>[];
    const message = choices[0]?.["message"] as Record<string, unknown>;
    assert.equal(message["content"], "hi");
  });

  it("fails on a stream that never terminated", async () => {
    // Arrange
    const source = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n';
    // Act and assert
    await assert.rejects(
      collapseStream(
        { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(source); } },
        "chat",
        "m",
      ),
      /unexpected end of SSE stream/,
    );
  });
});
