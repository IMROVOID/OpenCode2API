import type { BridgeBlock, Usage } from "../types/inference.js";
import { intAt } from "./json-util.js";

// firstNonZero returns the first value that is not zero.
export function firstNonZero(...values: number[]): number {
  for (const value of values) {
    if (value !== 0) {
      return value;
    }
  }
  return 0;
}

// decodeOpenAIUsage reads a Chat or Responses usage object. Either spelling of
// each field is accepted, prompt/input and completion/output alike, and the
// cache-read, cache-write and reasoning details are read from both the Chat
// and the Responses nesting.
export function decodeOpenAIUsage(usage: Record<string, unknown>): Usage {
  const input = firstNonZero(
    intAt(usage, "prompt_tokens"),
    intAt(usage, "input_tokens"),
  );
  const output = firstNonZero(
    intAt(usage, "completion_tokens"),
    intAt(usage, "output_tokens"),
  );
  let total = intAt(usage, "total_tokens");
  if (total === 0) {
    total = input + output;
  }
  const cached = firstNonZero(
    intAt(usage, "prompt_tokens_details", "cached_tokens"),
    intAt(usage, "input_tokens_details", "cached_tokens"),
  );
  const cacheCreation = firstNonZero(
    intAt(usage, "cache_creation_input_tokens"),
    intAt(usage, "prompt_tokens_details", "cache_creation_input_tokens"),
    intAt(usage, "prompt_tokens_details", "cache_write_tokens"),
    intAt(usage, "input_tokens_details", "cache_creation_input_tokens"),
  );
  const reasoning = firstNonZero(
    intAt(usage, "completion_tokens_details", "reasoning_tokens"),
    intAt(usage, "output_tokens_details", "reasoning_tokens"),
  );
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    cachedInputTokens: cached,
    cacheCreationTokens: cacheCreation,
    reasoningTokens: reasoning,
  };
}

// decodeAnthropicUsage reads an Anthropic usage object. Anthropic reports the
// cache parts separately from input_tokens, so the prompt input is the sum of
// the three, matching the prompt-token semantics the bridge uses.
export function decodeAnthropicUsage(usage: Record<string, unknown>): Usage {
  const cached = intAt(usage, "cache_read_input_tokens");
  const cacheCreation = intAt(usage, "cache_creation_input_tokens");
  const output = intAt(usage, "output_tokens");
  const input = intAt(usage, "input_tokens") + cached + cacheCreation;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    cachedInputTokens: cached,
    cacheCreationTokens: cacheCreation,
    reasoningTokens: 0,
  };
}

// openAIUsage renders bridge usage in the Chat usage shape.
export function openAIUsage(usage: Usage): Record<string, unknown> {
  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    prompt_tokens_details: { cached_tokens: usage.cachedInputTokens },
    completion_tokens_details: { reasoning_tokens: usage.reasoningTokens },
  };
}

// anthropicUsage renders bridge usage in the Anthropic shape, where
// input_tokens excludes the cache parts, so it is the prompt input minus the
// cache parts, floored at zero.
export function anthropicUsage(usage: Usage): Record<string, unknown> {
  return {
    input_tokens: Math.max(
      usage.inputTokens - usage.cachedInputTokens - usage.cacheCreationTokens,
      0,
    ),
    output_tokens: usage.outputTokens,
    cache_creation_input_tokens: usage.cacheCreationTokens,
    cache_read_input_tokens: usage.cachedInputTokens,
  };
}

// chatStop maps a canonical bridge stop reason onto Chat's finish_reason.
export function chatStop(stop: string): string {
  switch (stop) {
    case "tool_use":
    case "tool_calls":
      return "tool_calls";
    case "max_tokens":
    case "length":
      return "length";
    case "content_filter":
    case "error":
      return stop;
    default:
      return "stop";
  }
}

// anthropicStop maps a canonical bridge stop reason onto Anthropic's
// stop_reason.
export function anthropicStop(stop: string): string {
  switch (stop) {
    case "tool_use":
    case "tool_calls":
      return "tool_use";
    case "max_tokens":
    case "length":
      return "max_tokens";
    case "stop_sequence":
    case "pause_turn":
    case "refusal":
      return stop;
    default:
      return "end_turn";
  }
}

// canonicalChatStop maps Chat's finish_reason onto a canonical bridge stop
// reason.
export function canonicalChatStop(stop: string): string {
  switch (stop) {
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    case "error":
    case "network_error":
    case "server_error":
      return "error";
    default:
      return "stop";
  }
}

// canonicalAnthropicStop maps Anthropic's stop_reason onto a canonical bridge
// stop reason.
export function canonicalAnthropicStop(stop: string): string {
  switch (stop) {
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "length";
    case "stop_sequence":
    case "pause_turn":
    case "refusal":
      return stop;
    case "error":
    case "network_error":
    case "server_error":
      return "error";
    default:
      return "stop";
  }
}

// isToolStop reports whether a stop reason promises tool calls downstream. It
// accepts the canonical "tool_calls" as well as the raw "tool_use" and
// "function_call" spellings an upstream may report.
export function isToolStop(stop: string): boolean {
  return (
    stop === "tool_calls" || stop === "tool_use" || stop === "function_call"
  );
}

// usableToolBlocks drops phantom tool blocks that cannot be executed by a
// downstream client. Empty arguments are valid, so the tool name is the
// minimum required signal here.
export function usableToolBlocks(tools: BridgeBlock[]): BridgeBlock[] {
  return tools.filter((tool) => tool.name.trim() !== "");
}

// canonicalResponsesIncomplete maps a Responses incomplete_details.reason onto
// a canonical bridge stop reason: "content_filter" stays itself and any other
// reason, max_output_tokens included, becomes "length".
export function canonicalResponsesIncomplete(reason: string): string {
  return reason === "content_filter" ? "content_filter" : "length";
}

// responsesIncompleteReason is the inverse of canonicalResponsesIncomplete.
export function responsesIncompleteReason(stop: string): string {
  return stop === "content_filter" ? "content_filter" : "max_output_tokens";
}
