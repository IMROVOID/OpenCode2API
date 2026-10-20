import type { BridgeBlock, BridgeToolChoice } from "../types/inference.js";
import { isPlainObject, stringAt } from "./json-util.js";
import { randomID } from "./identity.js";

// schemaOrDefault substitutes an empty object schema for a tool that declared
// no parameters.
export function schemaOrDefault(value: unknown): unknown {
  if (value === undefined || value === null) {
    return { type: "object", properties: {} };
  }
  return value;
}

// chatResponseFormat converts a bridge-level response format into the Chat
// Completions shape. A value with no Chat equivalent is omitted.
export function chatResponseFormat(format: unknown): unknown {
  if (!isPlainObject(format)) {
    return undefined;
  }
  switch (stringAt(format, "type")) {
    case "json_object":
      return { type: "json_object" };
    case "json_schema": {
      const nested = format["json_schema"];
      if (isPlainObject(nested)) {
        return { type: "json_schema", json_schema: nested };
      }
      const built: Record<string, unknown> = {};
      for (const key of ["name", "description", "schema", "strict"]) {
        if (key in format) {
          built[key] = format[key];
        }
      }
      return Object.keys(built).length === 0
        ? undefined
        : { type: "json_schema", json_schema: built };
    }
    default:
      return undefined;
  }
}

// responsesTextFormat converts a bridge-level response format into the object
// accepted by the Responses "text.format" field. A Chat-style nested
// json_schema is flattened into the inline shape Responses expects.
export function responsesTextFormat(format: unknown): unknown {
  if (!isPlainObject(format)) {
    return undefined;
  }
  switch (stringAt(format, "type")) {
    case "text":
    case "json_object":
      return format;
    case "json_schema": {
      const nested = format["json_schema"];
      if (!isPlainObject(nested)) {
        return format;
      }
      return { ...nested, type: "json_schema" };
    }
    default:
      return undefined;
  }
}

// encodeChatToolChoice renders a bridge tool choice for Chat, nesting the name
// under a function object.
export function encodeChatToolChoice(choice: BridgeToolChoice): unknown {
  switch (choice.mode) {
    case "named":
      return { type: "function", function: { name: choice.name } };
    case "auto":
    case "none":
    case "required":
      return choice.mode;
    default:
      return undefined;
  }
}

// encodeResponsesToolChoice renders a bridge tool choice for Responses, with
// the name at the top level.
export function encodeResponsesToolChoice(choice: BridgeToolChoice): unknown {
  switch (choice.mode) {
    case "named":
      return { type: "function", name: choice.name };
    case "auto":
    case "none":
    case "required":
      return choice.mode;
    default:
      return undefined;
  }
}

// encodeAnthropicToolChoice renders a bridge tool choice for Anthropic. It
// returns undefined for "none", which Anthropic cannot express: the encoder
// omits the tools instead.
export function encodeAnthropicToolChoice(choice: BridgeToolChoice): unknown {
  switch (choice.mode) {
    case "named":
      return { type: "tool", name: choice.name };
    case "required":
      return { type: "any" };
    case "auto":
      return { type: choice.mode };
    default:
      return undefined;
  }
}

// normalizeResponsesRole maps a bridge message role onto a Responses message
// role: assistant stays, everything else becomes user.
export function normalizeResponsesRole(role: string): "assistant" | "user" {
  return role === "assistant" ? "assistant" : "user";
}

// minResponsesMaxOutputTokens is the smallest max_output_tokens the Zen
// Responses endpoint accepts; anything lower is rejected with a 400.
export const MIN_RESPONSES_MAX_OUTPUT_TOKENS = 16;

// floorResponsesMaxTokens keeps tiny downstream budgets from failing Zen
// responses validation.
export function floorResponsesMaxTokens(value: unknown): unknown {
  if (
    typeof value === "number" &&
    value > 0 &&
    value < MIN_RESPONSES_MAX_OUTPUT_TOKENS
  ) {
    return MIN_RESPONSES_MAX_OUTPUT_TOKENS;
  }
  return value;
}

// encodeResponsesReasoning renders a reasoning block as a Responses reasoning
// item with its text as the summary, synthesizing an ID when the block has
// none.
export function encodeResponsesReasoning(
  block: BridgeBlock,
  completed: boolean,
): Record<string, unknown> {
  const id = block.id !== "" ? block.id : randomID("rs", 12);
  const summary: unknown[] = [];
  if (block.text !== "") {
    summary.push({ type: "summary_text", text: block.text });
  }
  const item: Record<string, unknown> = { id, type: "reasoning", summary };
  if (block.encrypted !== "") {
    item["encrypted_content"] = block.encrypted;
  }
  if (completed) {
    item["status"] = "completed";
  }
  return item;
}

// encodeResponsesReasoningInput renders a reasoning block for the request
// path. Only reasoning the upstream actually issued is replayed: a block that
// arrived as plain text has no server-side id, and synthesizing one guarantees
// a stale reasoning-reference rejection.
export function encodeResponsesReasoningInput(
  block: BridgeBlock,
): { item: Record<string, unknown>; ok: boolean } {
  if (block.id === "" && block.encrypted === "") {
    return { item: {}, ok: false };
  }
  return { item: encodeResponsesReasoning(block, false), ok: true };
}
