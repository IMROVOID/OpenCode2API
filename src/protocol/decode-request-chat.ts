import type { BridgeBlock, BridgeRequest, BridgeTool } from "../types/inference.js";
import {
  boolAt,
  firstAny,
  intAt,
  isPlainObject,
  mapAt,
  sliceAt,
  stringAt,
} from "./json-util.js";
import { ProtocolError } from "./error.js";
import { emptyBlock } from "./block.js";
import { decodeOpenAIBlocks } from "./decode-blocks.js";
import { decodeChatReasoning } from "./decode-reasoning.js";
import { decodeChatToolChoice } from "./decode-request-shared.js";
import { withReasoningBudget } from "./reasoning.js";

// decodeChatRequest decodes an OpenAI Chat completion request onto the
// bridge model.
export function decodeChatRequest(
  request: BridgeRequest,
  input: Record<string, unknown>,
): void {
  request.maxTokens = firstAny(
    input["max_completion_tokens"],
    input["max_tokens"],
  );
  request.stop = input["stop"];
  request.reasoning = firstAny(input["reasoning_effort"], input["reasoning"]);

  const rawMessages = sliceAt(input, "messages");
  for (let i = 0; i < rawMessages.length; i++) {
    const message = rawMessages[i];
    if (!isPlainObject(message)) {
      throw new ProtocolError(`messages[${i}] must be an object`);
    }
    const role = stringAt(message, "role");
    let blocks: BridgeBlock[];
    try {
      blocks = decodeOpenAIBlocks(message["content"]);
    } catch (error) {
      throw new ProtocolError(`messages[${i}]: ${(error as Error).message}`);
    }
    if (role === "assistant") {
      blocks = [...decodeChatReasoning(message), ...blocks];
      const budget = intAt(message, "reasoning_budget_tokens");
      if (budget > 0) {
        request.reasoning = withReasoningBudget(request.reasoning, budget);
      }
    }
    const rawCalls = sliceAt(message, "tool_calls");
    for (let j = 0; j < rawCalls.length; j++) {
      const call = rawCalls[j];
      if (!isPlainObject(call)) {
        throw new ProtocolError(`messages[${i}].tool_calls[${j}] must be an object`);
      }
      const fn = mapAt(call, "function");
      const block = emptyBlock("tool_call");
      block.id = stringAt(call, "id");
      block.name = stringAt(fn, "name");
      block.argumentsJSON = stringAt(fn, "arguments");
      blocks.push(block);
    }
    switch (role) {
      case "system":
        request.system.push(...blocks);
        break;
      case "developer":
        request.developer.push(...blocks);
        break;
      case "tool": {
        const block = emptyBlock("tool_result");
        block.callId = stringAt(message, "tool_call_id");
        block.result = message["content"];
        request.messages.push({ role: "user", blocks: [block] });
        break;
      }
      case "user":
      case "assistant":
        request.messages.push({
          role,
          blocks,
        });
        break;
      default:
        throw new ProtocolError(
          `messages[${i}] has unsupported role ${JSON.stringify(role)}`,
        );
    }
  }

  const rawTools = sliceAt(input, "tools");
  for (let i = 0; i < rawTools.length; i++) {
    const tool = rawTools[i];
    if (!isPlainObject(tool) || stringAt(tool, "type") !== "function") {
      throw new ProtocolError(`tools[${i}] must be a function tool`);
    }
    const fn = mapAt(tool, "function");
    request.tools.push(chatTool(fn));
  }
  request.toolChoice = decodeChatToolChoice(input["tool_choice"]);
  request.responseFormat = input["response_format"];
  request.parallelToolCalls = input["parallel_tool_calls"];
  request.frequencyPenalty = input["frequency_penalty"];
  request.presencePenalty = input["presence_penalty"];
  request.seed = input["seed"];
  request.promptCacheKey = input["prompt_cache_key"];
  request.safetyIdentifier = input["safety_identifier"];
  request.serviceTier = input["service_tier"];
  request.store = input["store"];
}

// chatTool reads a Chat function tool onto the bridge.
function chatTool(fn: Record<string, unknown>): BridgeTool {
  return {
    name: stringAt(fn, "name"),
    description: stringAt(fn, "description"),
    schema: fn["parameters"],
    strict: boolAt(fn, "strict") ?? false,
  };
}
