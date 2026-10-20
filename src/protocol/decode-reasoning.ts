import type { BridgeBlock } from "../types/inference.js";
import { emptyBlock } from "./block.js";
import { firstAny, isPlainObject, mapAt, sliceAt, stringAt } from "./json-util.js";

// decodeChatReasoning reads a Chat message's reasoning into one block.
export function decodeChatReasoning(
  message: Record<string, unknown>,
): BridgeBlock[] {
  let value: unknown;
  if ("reasoning_content" in message) {
    value = message["reasoning_content"];
  } else {
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

// decodeResponsesReasoning folds a Responses reasoning item into one block.
export function decodeResponsesReasoning(
  item: Record<string, unknown>,
): BridgeBlock[] {
  let text = "";
  for (const raw of sliceAt(item, "summary")) {
    text += stringAt(raw, "text");
  }
  const content = item["content"];
  if (content !== undefined && content !== null) {
    for (const raw of Array.isArray(content) ? content : [content]) {
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

// anthropicReasoning decodes the reasoning controls of an Anthropic Messages
// request into a single bridge-level value. An effort the client states
// explicitly outranks a thinking block's budget.
export function anthropicReasoning(input: Record<string, unknown>): unknown {
  const stated = firstAny(
    mapAt(input, "output_config")["effort"],
    input["effort"],
  );
  const effort = normalizeEffort(stated);
  if (effort.ok) {
    if (effort.value === undefined) {
      return undefined;
    }
    const thinking = input["thinking"];
    if (isPlainObject(thinking)) {
      return { ...thinking, effort: effort.value };
    }
    return effort.value;
  }
  return input["thinking"];
}

// normalizeEffort maps a stated effort onto the bridge's effort value. "none"
// and "disabled" mean no effort at all, and an empty value states nothing.
function normalizeEffort(value: unknown): { value: unknown; ok: boolean } {
  if (typeof value !== "string") {
    return { value: undefined, ok: false };
  }
  const mode = value.trim().toLowerCase();
  if (mode === "none" || mode === "disabled") {
    return { value: undefined, ok: true };
  }
  if (mode === "") {
    return { value: undefined, ok: false };
  }
  return { value, ok: true };
}
