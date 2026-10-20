import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeBridgeRequest } from "../src/protocol/decode-request.js";
import { encodeBridgeRequest } from "../src/protocol/encode-request.js";
import { convertRequest } from "../src/protocol/convert.js";
import { convertResponse } from "../src/protocol/response.js";
import { decodeBridgeResponse } from "../src/protocol/response-decode.js";
import { encodeBridgeResponse } from "../src/protocol/response-encode.js";
import { ProtocolError } from "../src/protocol/error.js";

describe("decodeBridgeRequest (chat)", () => {
  it("decodes a user message", () => {
    // Arrange
    const body = {
      model: "m",
      messages: [{ role: "user", content: "hello" }],
    };
    // Act
    const request = decodeBridgeRequest("chat", body);
    // Assert
    assert.equal(request.model, "m");
    assert.equal(request.messages.length, 1);
    assert.equal(request.messages[0]?.role, "user");
    assert.equal(request.messages[0]?.blocks[0]?.text, "hello");
  });

  it("rejects an unsupported role", () => {
    // Arrange
    const body = { model: "m", messages: [{ role: "wizard", content: "x" }] };
    // Act and assert
    assert.throws(
      () => decodeBridgeRequest("chat", body),
      /unsupported role/,
    );
  });

  it("decodes a tool call into a tool_call block", () => {
    // Arrange
    const body = {
      model: "m",
      messages: [
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "call_1", function: { name: "read", arguments: "{}" } },
          ],
        },
      ],
    };
    // Act
    const request = decodeBridgeRequest("chat", body);
    // Assert
    assert.equal(request.messages[0]?.blocks[0]?.kind, "tool_call");
    assert.equal(request.messages[0]?.blocks[0]?.name, "read");
  });

  it("decodes a tool result into a user message", () => {
    // Arrange
    const body = {
      model: "m",
      messages: [{ role: "tool", tool_call_id: "call_1", content: "done" }],
    };
    // Act
    const request = decodeBridgeRequest("chat", body);
    // Assert
    assert.equal(request.messages[0]?.role, "user");
    assert.equal(request.messages[0]?.blocks[0]?.kind, "tool_result");
    assert.equal(request.messages[0]?.blocks[0]?.callId, "call_1");
  });

  it("decodes a function tool", () => {
    // Arrange
    const body = {
      model: "m",
      messages: [],
      tools: [
        {
          type: "function",
          function: { name: "read", description: "d", parameters: { type: "object" } },
        },
      ],
    };
    // Act
    const request = decodeBridgeRequest("chat", body);
    // Assert
    assert.equal(request.tools[0]?.name, "read");
    assert.equal(request.tools[0]?.description, "d");
  });

  it("rejects a tool that is not a function", () => {
    // Arrange
    const body = { model: "m", messages: [], tools: [{ type: "retrieval" }] };
    // Act and assert
    assert.throws(() => decodeBridgeRequest("chat", body), /must be a function tool/);
  });
});

describe("decodeBridgeRequest (responses)", () => {
  it("decodes a string input into a user message", () => {
    // Arrange
    const body = { model: "m", input: "hello" };
    // Act
    const request = decodeBridgeRequest("responses", body);
    // Assert
    assert.equal(request.messages[0]?.role, "user");
    assert.equal(request.messages[0]?.blocks[0]?.text, "hello");
  });

  it("joins consecutive function calls into one assistant message", () => {
    // Arrange
    const body = {
      model: "m",
      input: [
        { type: "function_call", call_id: "c1", name: "a", arguments: "{}" },
        { type: "function_call", call_id: "c2", name: "b", arguments: "{}" },
      ],
    };
    // Act
    const request = decodeBridgeRequest("responses", body);
    // Assert
    assert.equal(request.messages.length, 1);
    assert.equal(request.messages[0]?.blocks.length, 2);
  });

  it("rejects an unsupported input item type", () => {
    // Arrange
    const body = { model: "m", input: [{ type: "video" }] };
    // Act and assert
    assert.throws(
      () => decodeBridgeRequest("responses", body),
      /unsupported Responses item type/,
    );
  });
});

describe("decodeBridgeRequest (anthropic)", () => {
  it("decodes the system prompt and a user message", () => {
    // Arrange
    const body = {
      model: "m",
      system: "be brief",
      messages: [{ role: "user", content: "hello" }],
    };
    // Act
    const request = decodeBridgeRequest("anthropic", body);
    // Assert
    assert.equal(request.system[0]?.text, "be brief");
    assert.equal(request.messages[0]?.role, "user");
  });

  it("maps the any tool choice onto required", () => {
    // Arrange
    const body = {
      model: "m",
      messages: [],
      tool_choice: { type: "any" },
    };
    // Act
    const request = decodeBridgeRequest("anthropic", body);
    // Assert
    assert.equal(request.toolChoice.mode, "required");
  });
});

describe("encodeBridgeRequest (chat)", () => {
  it("forces the usage option on a streaming request", () => {
    // Arrange
    const request = decodeBridgeRequest("chat", {
      model: "m",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });
    // Act
    const body = encodeBridgeRequest("chat", request) as Record<string, unknown>;
    // Assert
    const options = body["stream_options"] as Record<string, unknown>;
    assert.equal(options["include_usage"], true);
  });

  it("encodes a user message", () => {
    // Arrange
    const request = decodeBridgeRequest("chat", {
      model: "m",
      messages: [{ role: "user", content: "hi" }],
    });
    // Act
    const body = encodeBridgeRequest("chat", request) as Record<string, unknown>;
    // Assert
    const messages = body["messages"] as Record<string, unknown>[];
    assert.equal(messages[0]?.["role"], "user");
    assert.equal(messages[0]?.["content"], "hi");
  });
});

describe("convertRequest", () => {
  it("returns a same-protocol body unchanged", () => {
    // Arrange
    const body = { model: "m", messages: [{ role: "user", content: "hi" }] };
    // Act
    const result = convertRequest("chat", "chat", body);
    // Assert
    assert.deepEqual(result, body);
  });

  it("converts a chat request into a responses request", () => {
    // Arrange
    const body = { model: "m", messages: [{ role: "user", content: "hi" }] };
    // Act
    const result = convertRequest("chat", "responses", body) as Record<string, unknown>;
    // Assert
    assert.equal(result["model"], "m");
    const input = result["input"] as unknown;
    assert.ok(Array.isArray(input));
  });

  it("converts a chat request into an anthropic request", () => {
    // Arrange
    const body = { model: "m", messages: [{ role: "user", content: "hi" }] };
    // Act
    const result = convertRequest("chat", "anthropic", body) as Record<string, unknown>;
    // Assert
    assert.equal(result["model"], "m");
    assert.ok(Array.isArray(result["messages"]));
  });
});

describe("response codec", () => {
  it("decodes and re-encodes a chat response", () => {
    // Arrange
    const body = {
      id: "chatcmpl_1",
      model: "m",
      created: 100,
      choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    };
    // Act
    const decoded = decodeBridgeResponse("chat", body);
    const encoded = encodeBridgeResponse("chat", decoded) as Record<string, unknown>;
    // Assert
    assert.equal(encoded["id"], "chatcmpl_1");
    const choices = encoded["choices"] as Record<string, unknown>[];
    const message = choices[0]?.["message"] as Record<string, unknown>;
    assert.equal(message["content"], "hi");
  });

  it("keeps a same-protocol response unchanged", () => {
    // Arrange
    const body = JSON.stringify({ id: "chatcmpl_1", choices: [] });
    // Act
    const result = convertResponse("chat", "chat", body);
    // Assert
    assert.equal(result, body);
  });

  it("rejects an upstream error body", () => {
    // Arrange
    const body = JSON.stringify({ error: { message: "upstream broke" } });
    // Act and assert
    assert.throws(() => convertResponse("chat", "responses", body), ProtocolError);
  });

  it("demotes a tool stop with no usable tool to a plain stop", () => {
    // Arrange
    const response = {
      id: "resp_1",
      model: "m",
      text: "",
      reasoning: [],
      tools: [],
      stop: "tool_calls",
      error: "",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        reasoningTokens: 0,
      },
      created: 100,
    };
    // Act
    const encoded = encodeBridgeResponse("chat", response) as Record<string, unknown>;
    // Assert
    const choices = encoded["choices"] as Record<string, unknown>[];
    assert.equal(choices[0]?.["finish_reason"], "stop");
  });
});
