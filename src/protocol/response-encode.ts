import type { BridgeBlock, BridgeResponse } from "../types/inference.js";
import { isPlainObject } from "./json-util.js";
import { asPrefix, randomID } from "./identity.js";
import {
  anthropicStop,
  anthropicUsage,
  chatStop,
  decodeAnthropicUsage,
  decodeOpenAIUsage,
  isToolStop,
  openAIUsage,
  responsesIncompleteReason,
  usableToolBlocks,
} from "./response-usage.js";
import {
  bridgeArgumentsJSON,
  bridgeReasoningSignature,
  bridgeReasoningText,
  encodeAnthropicBlocks,
} from "./encode-blocks.js";
import { encodeResponsesReasoning } from "./encode-shared.js";
import { parseJSONOrStringValue } from "./block.js";

// encodeBridgeResponse encodes a bridge response as the target protocol's body.
// A tool stop with no usable tool block is demoted to a plain stop first, and
// an ID is synthesized when the response has none.
export function encodeBridgeResponse(
  protocol: string,
  input: BridgeResponse,
): Record<string, unknown> {
  const response = demotePhantomToolStop(input);
  const id = response.id !== "" ? response.id : randomID("resp", 12);
  switch (protocol) {
    case "chat":
      return encodeChatResponse(response, id);
    case "responses":
      return encodeResponsesResponse(response, id);
    case "anthropic":
      return encodeAnthropicResponse(response, id);
    default:
      return {};
  }
}

// demotePhantomToolStop returns a copy of the response whose tool stop is
// demoted to a plain stop when no usable tool block was assembled. A tool_use
// stop with no usable tool blocks makes strict clients end the turn running
// nothing and reporting no error.
function demotePhantomToolStop(input: BridgeResponse): BridgeResponse {
  if (!isToolStop(input.stop)) {
    return input;
  }
  const tools = usableToolBlocks(input.tools);
  if (tools.length > 0) {
    return { ...input, tools };
  }
  return { ...input, tools: [], stop: "stop" };
}

function encodeChatResponse(
  response: BridgeResponse,
  id: string,
): Record<string, unknown> {
  const message: Record<string, unknown> = {
    role: "assistant",
    content: response.text,
  };
  const reasoning = bridgeReasoningText(response.reasoning);
  if (reasoning.ok) {
    message["reasoning_content"] = reasoning.text;
  }
  const signature = bridgeReasoningSignature(response.reasoning);
  if (signature !== "") {
    message["reasoning_signature"] = signature;
  }
  if (response.tools.length > 0) {
    const calls = response.tools.map((tool) => ({
      id: tool.id,
      type: "function",
      function: {
        name: tool.name,
        arguments: bridgeArgumentsJSON(tool),
      },
    }));
    message["tool_calls"] = calls;
  }
  return {
    id: asPrefix(id, "chatcmpl"),
    object: "chat.completion",
    created: response.created,
    model: response.model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: chatStop(response.stop),
      },
    ],
    usage: openAIUsage(response.usage),
  };
}

function encodeResponsesResponse(
  response: BridgeResponse,
  id: string,
): Record<string, unknown> {
  const output: unknown[] = [];
  for (const reasoning of response.reasoning) {
    output.push(encodeResponsesReasoning(reasoning, true));
  }
  if (response.text !== "") {
    output.push({
      id: randomID("msg", 12),
      type: "message",
      status: "completed",
      role: "assistant",
      content: [
        { type: "output_text", text: response.text, annotations: [] },
      ],
    });
  }
  for (const tool of response.tools) {
    output.push({
      id: randomID("fc", 12),
      type: "function_call",
      status: "completed",
      call_id: tool.id,
      name: tool.name,
      arguments: bridgeArgumentsJSON(tool),
    });
  }
  let status = "completed";
  let incomplete: unknown = null;
  if (response.stop === "length" || response.stop === "content_filter") {
    status = "incomplete";
    incomplete = { reason: responsesIncompleteReason(response.stop) };
  } else if (response.stop === "error") {
    status = "failed";
  }
  return {
    id: asPrefix(id, "resp"),
    object: "response",
    created_at: response.created,
    status,
    model: response.model,
    output,
    error: null,
    incomplete_details: incomplete,
    usage: {
      input_tokens: response.usage.inputTokens,
      output_tokens: response.usage.outputTokens,
      total_tokens: response.usage.totalTokens,
      input_tokens_details: { cached_tokens: response.usage.cachedInputTokens },
      output_tokens_details: {
        reasoning_tokens: response.usage.reasoningTokens,
      },
    },
  };
}

function encodeAnthropicResponse(
  response: BridgeResponse,
  id: string,
): Record<string, unknown> {
  const content: unknown[] = [...encodeAnthropicBlocks(response.reasoning)];
  if (response.text !== "") {
    content.push({ type: "text", text: response.text });
  }
  for (const tool of response.tools) {
    content.push({
      type: "tool_use",
      id: tool.id,
      name: tool.name,
      input: toolInput(tool),
    });
  }
  return {
    id: asPrefix(id, "msg"),
    type: "message",
    role: "assistant",
    model: response.model,
    content,
    stop_reason: anthropicStop(response.stop),
    stop_sequence: null,
    usage: anthropicUsage(response.usage),
  };
}

// toolInput returns a tool call's decoded arguments, falling back to its raw
// JSON text.
function toolInput(tool: BridgeBlock): unknown {
  if (tool.arguments === undefined || tool.arguments === null) {
    return parseJSONOrStringValue(tool.argumentsJSON);
  }
  return tool.arguments;
}

// responseUsage extracts the usage of a serialized response body and reports
// whether it carried any.
export function responseUsage(
  protocol: string,
  body: unknown,
): { usage: BridgeResponse["usage"]; present: boolean } {
  if (!isPlainObject(body)) {
    return { usage: emptyUsage(), present: false };
  }
  const usage = body["usage"];
  if (!isPlainObject(usage) || Object.keys(usage).length === 0) {
    return { usage: emptyUsage(), present: false };
  }
  if (protocol === "anthropic") {
    return { usage: decodeAnthropicUsage(usage), present: true };
  }
  return { usage: decodeOpenAIUsage(usage), present: true };
}

function emptyUsage(): BridgeResponse["usage"] {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
  };
}
