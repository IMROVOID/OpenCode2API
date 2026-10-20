import { isPlainObject, stringAt } from "./json-util.js";
import { ANTHROPIC_REDACTED_THINKING_PLACEHOLDER } from "./block.js";
import { TOOL_REASONING_PLACEHOLDER, isReasoningVendorIdentifier } from "./reasoning.js";

// normalizeToolReasoningHistory repairs the reasoning history of assistant
// tool-call turns in a prepared upstream body.
//
// It applies only to endpoints that are known to require reasoning replay,
// identified by the model or upstream URL naming a reasoning vendor; a Chat
// body is also repaired when the request explicitly enables reasoning.
// Responses bodies are never touched.
export function normalizeToolReasoningHistory(
  protocol: string,
  model: string,
  upstreamURL: string,
  input: Record<string, unknown>,
): boolean {
  const vendor =
    isReasoningVendorIdentifier(model) || isReasoningVendorIdentifier(upstreamURL);
  if (protocol === "chat") {
    if (!vendor && !requestEnablesReasoning(input)) {
      return false;
    }
    return normalizeChatToolReasoningHistory(input);
  }
  if (protocol === "anthropic") {
    if (!vendor) {
      return false;
    }
    return normalizeAnthropicToolThinkingHistory(input);
  }
  return false;
}

// normalizeChatToolReasoningHistory ensures every assistant tool-call turn
// carries reasoning_content. Some clients discard this non-standard field
// while retaining tool_calls, which otherwise makes the next thinking-mode
// request invalid.
export function normalizeChatToolReasoningHistory(
  input: Record<string, unknown>,
): boolean {
  const messages = input["messages"];
  if (!Array.isArray(messages)) {
    return false;
  }
  let changed = false;
  for (const raw of messages) {
    if (!isPlainObject(raw) || raw["role"] !== "assistant") {
      continue;
    }
    const calls = raw["tool_calls"];
    if (!Array.isArray(calls) || calls.length === 0) {
      continue;
    }
    const existing = raw["reasoning_content"];
    if (typeof existing === "string" && existing.trim() !== "") {
      continue;
    }
    const legacy = raw["reasoning"];
    let reasoning =
      typeof legacy === "string" && legacy.trim() !== "" ? legacy : "";
    if (reasoning === "") {
      reasoning = TOOL_REASONING_PLACEHOLDER;
    }
    raw["reasoning_content"] = reasoning;
    changed = true;
  }
  return changed;
}

// normalizeAnthropicToolThinkingHistory repairs only assistant turns that
// contain tool_use. It strips thinking signatures, replaces redacted_thinking
// blocks and empty thinking text with placeholders, and prepends a placeholder
// thinking block to a turn that has none.
export function normalizeAnthropicToolThinkingHistory(
  input: Record<string, unknown>,
): boolean {
  const messages = input["messages"];
  if (!Array.isArray(messages)) {
    return false;
  }
  let changed = false;
  for (const raw of messages) {
    if (!isPlainObject(raw) || raw["role"] !== "assistant") {
      continue;
    }
    const content = raw["content"];
    if (!Array.isArray(content) || !contentHasType(content, "tool_use")) {
      continue;
    }
    let hasThinking = false;
    const blocks: unknown[] = [];
    for (const rawBlock of content) {
      if (!isPlainObject(rawBlock)) {
        blocks.push(rawBlock);
        continue;
      }
      const type = stringAt(rawBlock, "type");
      if (type === "thinking") {
        hasThinking = true;
        const block: Record<string, unknown> = { ...rawBlock };
        if ("signature" in block) {
          delete block["signature"];
          changed = true;
        }
        const thinking = block["thinking"];
        if (typeof thinking !== "string" || thinking.trim() === "") {
          block["thinking"] = TOOL_REASONING_PLACEHOLDER;
          changed = true;
        }
        blocks.push(block);
        continue;
      }
      if (type === "redacted_thinking") {
        hasThinking = true;
        blocks.push({
          type: "thinking",
          thinking: ANTHROPIC_REDACTED_THINKING_PLACEHOLDER,
        });
        changed = true;
        continue;
      }
      blocks.push(rawBlock);
    }
    if (!hasThinking) {
      blocks.unshift({
        type: "thinking",
        thinking: TOOL_REASONING_PLACEHOLDER,
      });
      changed = true;
    }
    if (changed) {
      raw["content"] = blocks;
    }
  }
  return changed;
}

function contentHasType(content: unknown[], kind: string): boolean {
  return content.some(
    (raw) => isPlainObject(raw) && stringAt(raw, "type") === kind,
  );
}

function requestEnablesReasoning(input: Record<string, unknown>): boolean {
  for (const key of ["reasoning_effort", "reasoning", "thinking", "effort"]) {
    const value = input[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string") {
      const mode = value.trim().toLowerCase();
      if (mode !== "" && mode !== "none" && mode !== "disabled") {
        return true;
      }
      continue;
    }
    if (typeof value === "boolean") {
      if (value) {
        return true;
      }
      continue;
    }
    if (isPlainObject(value)) {
      const mode = (stringAt(value, "type") || stringAt(value, "effort"))
        .trim()
        .toLowerCase();
      if (mode === "none" || mode === "disabled") {
        continue;
      }
      return true;
    }
    return true;
  }
  return false;
}
