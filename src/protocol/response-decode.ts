import type { BridgeBlock, BridgeResponse } from "../types/inference.js";
import { firstString, intAt, isPlainObject, sliceAt, stringAt } from "./json-util.js";
import { emptyBlock } from "./block.js";
import { ProtocolError } from "./error.js";
import { decodeAnthropicBlocks, decodeOpenAIBlocks } from "./decode-blocks.js";
import {
  canonicalAnthropicStop,
  canonicalChatStop,
  canonicalResponsesIncomplete,
  decodeAnthropicUsage,
  decodeOpenAIUsage,
} from "./response-usage.js";

// decodeChatReasoning reads a Chat message's reasoning into one block: the
// reasoning_content string, or the "reasoning" string when reasoning_content
// is absent, together with any reasoning_signature.
function decodeChatReasoning(
  message: Record<string, unknown>,
): BridgeBlock[] {
  let value = message["reasoning_content"];
  if (value === undefined) {
    value = message["reasoning"];
  }
  if (typeof value !== "string") {
    return [];
  }
  const block = emptyBlock("reasoning");
  block.text = value;
  block.signature = stringAt(message, "reasoning_signature");
  return [block];
}

// decodeResponsesReasoning folds a Responses reasoning item into one block: its
// summary and content texts are concatenated, and its ID and encrypted_content
// are kept.
function decodeResponsesReasoning(
  item: Record<string, unknown>,
): BridgeBlock[] {
  let text = "";
  for (const raw of asArray(item["summary"])) {
    text += stringAt(raw, "text");
  }
  const content = item["content"];
  if (content !== undefined && content !== null) {
    for (const raw of asArray(content)) {
      text += stringAt(raw, "text");
    }
  }
  const encrypted = stringAt(item, "encrypted_content");
  if (text === "" && encrypted === "") {
    return [];
  }
  const block = emptyBlock("reasoning");
  block.id = stringAt(item, "id");
  block.text = text;
  block.encrypted = encrypted;
  return [block];
}

// asArray returns the value as an array, promoting a single value.
function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

// decodeBridgeResponse decodes a complete response body of the given protocol
// into the bridge model. An error envelope or error status is reported in
// response.error, an unknown output item, content block or protocol is an
// error, and a missing creation time defaults to now.
export function decodeBridgeResponse(
  protocol: string,
  input: Record<string, unknown>,
): BridgeResponse {
  const response: BridgeResponse = {
    id: stringAt(input, "id"),
    model: stringAt(input, "model"),
    text: "",
    reasoning: [],
    tools: [],
    stop: "",
    error: "",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0,
    },
    created: intAt(input, "created"),
  };
  if (response.created === 0) {
    response.created = intAt(input, "created_at");
  }
  if (response.created === 0) {
    response.created = Math.floor(Date.now() / 1000);
  }
  switch (protocol) {
    case "chat":
      decodeChatResponse(response, input);
      break;
    case "responses":
      decodeResponsesResponse(response, input);
      break;
    case "anthropic":
      decodeAnthropicResponse(response, input);
      break;
    default:
      throw new ProtocolError(
        `unsupported response protocol ${JSON.stringify(protocol)}`,
      );
  }
  return response;
}

function decodeChatResponse(
  response: BridgeResponse,
  input: Record<string, unknown>,
): void {
  const message = stringAt(input, "error", "message");
  if (message !== "") {
    response.error = message;
    return;
  }
  const choices = sliceAt(input, "choices");
  if (choices.length === 0) {
    throw new ProtocolError("chat response contains no choices");
  }
  const choice = choices[0];
  const body = isPlainObject(choice) ? choice : {};
  const messageBody = isPlainObject(body["message"]) ? body["message"] : {};
  response.reasoning = decodeChatReasoning(messageBody);
  const blocks = decodeOpenAIBlocks(messageBody["content"]);
  response.text = responseTextBlocks(blocks, "Chat");
  for (const raw of sliceAt(messageBody, "tool_calls")) {
    const call = isPlainObject(raw) ? raw : {};
    const fn = isPlainObject(call["function"]) ? call["function"] : {};
    const block = emptyBlock("tool_call");
    block.id = stringAt(call, "id");
    block.name = stringAt(fn, "name");
    block.argumentsJSON = stringAt(fn, "arguments");
    response.tools.push(block);
  }
  response.stop = canonicalChatStop(stringAt(body, "finish_reason"));
  response.usage = decodeOpenAIUsage(mapOrEmpty(input, "usage"));
}

function decodeResponsesResponse(
  response: BridgeResponse,
  input: Record<string, unknown>,
): void {
  for (const raw of sliceAt(input, "output")) {
    const item = isPlainObject(raw) ? raw : {};
    switch (stringAt(item, "type")) {
      case "reasoning":
        response.reasoning.push(...decodeResponsesReasoning(item));
        break;
      case "message": {
        const blocks = decodeOpenAIBlocks(item["content"]);
        response.text += responseTextBlocks(blocks, "Responses");
        break;
      }
      case "function_call": {
        const block = emptyBlock("tool_call");
        block.id = firstString(stringAt(item, "call_id"), stringAt(item, "id"));
        block.name = stringAt(item, "name");
        block.argumentsJSON = stringAt(item, "arguments");
        response.tools.push(block);
        break;
      }
      default:
        throw new ProtocolError(
          `Responses response has unsupported output item type ${JSON.stringify(stringAt(item, "type"))}`,
        );
    }
  }
  response.stop = response.tools.length > 0 ? "tool_calls" : "stop";
  const status = stringAt(input, "status");
  if (status === "incomplete") {
    response.stop = canonicalResponsesIncomplete(
      stringAt(input, "incomplete_details", "reason"),
    );
  } else if (status === "failed") {
    response.stop = "error";
    response.error = firstString(
      stringAt(input, "error", "message"),
      "upstream Responses request failed",
    );
  }
  response.usage = decodeOpenAIUsage(mapOrEmpty(input, "usage"));
}

function decodeAnthropicResponse(
  response: BridgeResponse,
  input: Record<string, unknown>,
): void {
  if (stringAt(input, "type") === "error") {
    response.error = firstString(
      stringAt(input, "error", "message"),
      "upstream Anthropic request failed",
    );
  }
  const blocks = decodeAnthropicBlocks(input["content"]);
  for (const block of blocks) {
    if (block.kind === "reasoning") {
      response.reasoning.push(block);
    } else if (block.kind === "text") {
      response.text += block.text;
    } else if (block.kind === "tool_call") {
      response.tools.push(block);
    } else {
      throw new ProtocolError(
        `Anthropic response contains unsupported ${block.kind} content block`,
      );
    }
  }
  response.stop = canonicalAnthropicStop(stringAt(input, "stop_reason"));
  response.usage = decodeAnthropicUsage(mapOrEmpty(input, "usage"));
}

// mapOrEmpty returns the value at the key as an object, or an empty object.
export function mapOrEmpty(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const found = value[key];
  return isPlainObject(found) ? found : {};
}

// responseTextBlocks joins the text of blocks, erroring on any other kind:
// neither a Chat message nor a Responses output message may carry more than
// text.
function responseTextBlocks(blocks: BridgeBlock[], protocol: string): string {
  let text = "";
  for (const block of blocks) {
    if (block.kind !== "text") {
      throw new ProtocolError(
        `${protocol} response contains unsupported ${block.kind} content block`,
      );
    }
    text += block.text;
  }
  return text;
}
