import type { BridgeBlock, BridgeMessage, BridgeToolChoice } from "../types/inference.js";
import { isPlainObject, stringAt } from "./json-util.js";

// appendBridgeBlock adds a block decoded from a standalone Responses item. It
// joins the previous message when that has the same role and holds only tool
// calls or results.
export function appendBridgeBlock(
  messages: BridgeMessage[],
  role: "user" | "assistant",
  block: BridgeBlock,
): void {
  const last = messages[messages.length - 1];
  if (last && last.role === role && bridgeBlocksOnlyTools(last.blocks)) {
    last.blocks = [...last.blocks, block];
    return;
  }
  messages.push({ role, blocks: [block] });
}

// bridgeBlocksOnlyTools reports whether blocks is non-empty and holds only
// tool calls and tool results.
export function bridgeBlocksOnlyTools(blocks: BridgeBlock[]): boolean {
  if (blocks.length === 0) {
    return false;
  }
  return blocks.every(
    (block) => block.kind === "tool_call" || block.kind === "tool_result",
  );
}

export function emptyToolChoice(): BridgeToolChoice {
  return { mode: "", name: "" };
}

// decodeChatToolChoice maps a Chat tool_choice onto the bridge.
export function decodeChatToolChoice(value: unknown): BridgeToolChoice {
  if (typeof value === "string") {
    return { mode: value as BridgeToolChoice["mode"], name: "" };
  }
  if (isPlainObject(value) && stringAt(value, "type") === "function") {
    return { mode: "named", name: stringAt(value, "function", "name") };
  }
  return emptyToolChoice();
}

// decodeResponsesToolChoice maps a Responses tool_choice onto the bridge.
export function decodeResponsesToolChoice(value: unknown): BridgeToolChoice {
  if (typeof value === "string") {
    return { mode: value as BridgeToolChoice["mode"], name: "" };
  }
  if (isPlainObject(value) && stringAt(value, "type") === "function") {
    return { mode: "named", name: stringAt(value, "name") };
  }
  return emptyToolChoice();
}

// decodeAnthropicToolChoice maps an Anthropic tool_choice onto the bridge,
// where Anthropic's "any" is "required" and "tool" is a named choice.
export function decodeAnthropicToolChoice(value: unknown): BridgeToolChoice {
  if (typeof value === "string") {
    const mode = value === "required" ? "any" : value;
    return decodeAnthropicToolChoice({ type: mode });
  }
  if (!isPlainObject(value)) {
    return emptyToolChoice();
  }
  switch (stringAt(value, "type")) {
    case "auto":
      return { mode: "auto", name: "" };
    case "none":
      return { mode: "none", name: "" };
    case "any":
      return { mode: "required", name: "" };
    case "tool":
      return { mode: "named", name: stringAt(value, "name") };
    default:
      return emptyToolChoice();
  }
}
