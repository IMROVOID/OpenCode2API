import type {
  BridgeBlock,
  BridgeMessage,
  BridgeRequest,
} from "../types/inference.js";
import { put } from "./json-util.js";
import { ProtocolError } from "./error.js";
import { bridgeArgumentsJSON, bridgeReasoningText } from "./encode-blocks.js";
import { chatToolImages } from "./tool-images.js";
import { encodeChatBlocks } from "./encode-blocks.js";
import { reasoningBudget, reasoningEffort } from "./reasoning.js";
import {
  chatResponseFormat,
  encodeChatToolChoice,
  schemaOrDefault,
} from "./encode-shared.js";

interface ChatToolState {
  pending: Set<string>;
  pendingResults: Map<string, BridgeBlock>;
  pendingOrder: string[];
  deferred: BridgeBlock[][];
  budgetCarried: boolean;
}

// encodeChatRequest encodes a bridge request as a Chat Completions body.
//
// Chat answers each tool call with a separate "tool" message that must follow
// the assistant message carrying the calls, so the encoder tracks pending
// calls: once every pending call has a result, the tool messages are emitted
// in call order, followed by user messages for any images the results carried
// (a tool message holds only text), and then by user content that arrived
// while the calls were pending. A history that breaks the call/result pairing
// is an error.
export function encodeChatRequest(
  request: BridgeRequest,
): Record<string, unknown> {
  const output: Record<string, unknown> = {
    model: request.model,
    stream: request.stream,
  };
  put(output, "temperature", request.temperature);
  put(output, "top_p", request.topP);
  put(output, "max_tokens", request.maxTokens);
  put(output, "stop", request.stop);
  const effort = reasoningEffort(request.reasoning);
  if (effort !== undefined && effort !== null) {
    output["reasoning_effort"] = effort;
  }
  put(output, "response_format", chatResponseFormat(request.responseFormat));
  put(output, "parallel_tool_calls", request.parallelToolCalls);
  put(output, "frequency_penalty", request.frequencyPenalty);
  put(output, "presence_penalty", request.presencePenalty);
  put(output, "seed", request.seed);
  put(output, "prompt_cache_key", request.promptCacheKey);
  put(output, "safety_identifier", request.safetyIdentifier);
  put(output, "service_tier", request.serviceTier);
  put(output, "store", request.store);
  if (request.stream) {
    output["stream_options"] = { include_usage: true };
  }

  const messages: Record<string, unknown>[] = [];
  if (request.system.length > 0) {
    messages.push({
      role: "system",
      content: encodeChatBlocks(request.system),
    });
  }
  if (request.developer.length > 0) {
    messages.push({
      role: "developer",
      content: encodeChatBlocks(request.developer),
    });
  }

  const state: ChatToolState = {
    pending: new Set<string>(),
    pendingResults: new Map<string, BridgeBlock>(),
    pendingOrder: [],
    deferred: [],
    budgetCarried: false,
  };

  for (let i = 0; i < request.messages.length; i++) {
    const message = request.messages[i];
    if (message === undefined) {
      continue;
    }
    const { content, reasoning, calls, results } = splitBlocks(message);

    if (message.role === "assistant") {
      if (state.pending.size > 0) {
        throw new ProtocolError(
          `messages[${i}]: assistant message appears before tool results for ${missingToolIDs(
            state,
          ).join(", ")}`,
        );
      }
      if (results.length > 0) {
        throw new ProtocolError(
          `messages[${i}]: assistant message contains tool results`,
        );
      }
      const encoded: Record<string, unknown> = { role: "assistant", content: null };
      carryBudget(state, encoded, request);
      const reasoningText = bridgeReasoningText(reasoning);
      if (reasoningText.ok) {
        encoded["reasoning_content"] = reasoningText.text;
      }
      if (content.length > 0) {
        encoded["content"] = encodeChatBlocks(content);
      }
      if (calls.length > 0) {
        const toolCalls: unknown[] = [];
        for (const call of calls) {
          if (call.id === "" || call.name === "") {
            throw new ProtocolError(
              `messages[${i}]: tool call must contain id and name`,
            );
          }
          if (state.pending.has(call.id)) {
            throw new ProtocolError(
              `messages[${i}]: duplicate tool call id ${JSON.stringify(call.id)}`,
            );
          }
          state.pending.add(call.id);
          state.pendingOrder.push(call.id);
          toolCalls.push({
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments: bridgeArgumentsJSON(call),
            },
          });
        }
        encoded["tool_calls"] = toolCalls;
      }
      if (content.length > 0 || reasoning.length > 0 || calls.length > 0) {
        messages.push(encoded);
        state.budgetCarried = true;
      }
      continue;
    }

    if (calls.length > 0) {
      throw new ProtocolError(
        `messages[${i}]: user message contains tool calls`,
      );
    }
    for (const result of results) {
      if (state.pendingResults.has(result.callId)) {
        throw new ProtocolError(
          `messages[${i}]: duplicate tool result ${JSON.stringify(result.callId)}`,
        );
      }
      if (!state.pending.has(result.callId)) {
        throw new ProtocolError(
          `messages[${i}]: tool result ${JSON.stringify(result.callId)} has no pending tool call`,
        );
      }
      state.pendingResults.set(result.callId, result);
      state.pending.delete(result.callId);
    }
    if (content.length > 0) {
      if (state.pendingOrder.length > 0 || state.deferred.length > 0) {
        state.deferred.push(content);
      } else {
        messages.push({ role: "user", content: encodeChatBlocks(content) });
      }
    }
    if (state.pending.size === 0 && state.pendingOrder.length > 0) {
      const attachments: Record<string, unknown>[] = [];
      for (const id of state.pendingOrder) {
        const result = state.pendingResults.get(id);
        if (!result) {
          continue;
        }
        const { text, images } = chatToolImages(result);
        if (images.length > 0) {
          attachments.push({
            role: "user",
            content: encodeChatBlocks(images),
          });
        }
        messages.push({ role: "tool", tool_call_id: id, content: text });
      }
      messages.push(...attachments);
      flushDeferred(state, messages);
      state.pendingOrder = [];
      state.pendingResults.clear();
    }
  }

  if (state.pending.size > 0) {
    throw new ProtocolError(
      `tool calls are missing results for ${missingToolIDs(state).join(", ")}`,
    );
  }
  flushDeferred(state, messages);
  carryBudgetOnly(state, messages, request);
  output["messages"] = messages;

  if (request.tools.length > 0) {
    const tools = request.tools.map((tool) => {
      const fn: Record<string, unknown> = {
        name: tool.name,
        description: tool.description,
        parameters: schemaOrDefault(tool.schema),
      };
      if (tool.strict) {
        fn["strict"] = true;
      }
      return { type: "function", function: fn };
    });
    output["tools"] = tools;
    const choice = encodeChatToolChoice(request.toolChoice);
    if (choice !== undefined) {
      output["tool_choice"] = choice;
    }
  }
  return output;
}

function splitBlocks(message: BridgeMessage): {
  content: BridgeBlock[];
  reasoning: BridgeBlock[];
  calls: BridgeBlock[];
  results: BridgeBlock[];
} {
  const content: BridgeBlock[] = [];
  const reasoning: BridgeBlock[] = [];
  const calls: BridgeBlock[] = [];
  const results: BridgeBlock[] = [];
  for (const block of message.blocks) {
    switch (block.kind) {
      case "reasoning":
        reasoning.push(block);
        break;
      case "tool_call":
        calls.push(block);
        break;
      case "tool_result":
        results.push(block);
        break;
      default:
        content.push(block);
        break;
    }
  }
  return { content, reasoning, calls, results };
}

// carryBudget emits the thinking budget the client named once, as
// reasoning_budget_tokens on the first assistant message, so that decoding
// this Chat body back into Anthropic can restore the budget exactly.
function carryBudget(
  state: ChatToolState,
  encoded: Record<string, unknown>,
  request: BridgeRequest,
): void {
  if (state.budgetCarried) {
    return;
  }
  const budget = reasoningBudget(request.reasoning);
  if (budget > 0) {
    encoded["reasoning_budget_tokens"] = budget;
    state.budgetCarried = true;
  }
}

// carryBudgetOnly attaches the budget to an empty assistant message when the
// conversation ended before any assistant turn existed to carry it.
function carryBudgetOnly(
  state: ChatToolState,
  messages: Record<string, unknown>[],
  request: BridgeRequest,
): void {
  if (state.budgetCarried) {
    return;
  }
  if (reasoningBudget(request.reasoning) <= 0) {
    return;
  }
  const encoded: Record<string, unknown> = { role: "assistant", content: null };
  carryBudget(state, encoded, request);
  if (encoded["reasoning_budget_tokens"] === undefined) {
    return;
  }
  messages.push(encoded);
}

function flushDeferred(
  state: ChatToolState,
  messages: Record<string, unknown>[],
): void {
  for (const blocks of state.deferred) {
    if (blocks.length > 0) {
      messages.push({ role: "user", content: encodeChatBlocks(blocks) });
    }
  }
  state.deferred = [];
}

// missingToolIDs lists the tool calls still waiting for a result: in call
// order when that accounts for every pending call, and sorted otherwise.
function missingToolIDs(state: ChatToolState): string[] {
  const missing: string[] = [];
  for (const id of state.pendingOrder) {
    if (state.pending.has(id)) {
      missing.push(id);
    }
  }
  if (missing.length === state.pending.size) {
    return missing;
  }
  for (const id of state.pending) {
    if (!missing.includes(id)) {
      missing.push(id);
    }
  }
  return missing.sort();
}
