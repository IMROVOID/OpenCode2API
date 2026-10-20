import type { BridgeBlock, BridgeRequest, BridgeTool } from "../types/inference.js";
import {
  boolAt,
  firstAny,
  firstString,
  isPlainObject,
  mapAt,
  sliceAt,
  stringAt,
} from "./json-util.js";
import { ProtocolError } from "./error.js";
import { emptyBlock } from "./block.js";
import { decodeOpenAIBlocks } from "./decode-blocks.js";
import { decodeResponsesReasoning } from "./decode-reasoning.js";
import { appendBridgeBlock, decodeResponsesToolChoice } from "./decode-request-shared.js";

// decodeResponsesRequest decodes a Responses request onto the bridge model.
export function decodeResponsesRequest(
  request: BridgeRequest,
  input: Record<string, unknown>,
): void {
  request.maxTokens = input["max_output_tokens"];
  request.stop = input["stop"];
  request.reasoning = firstAny(input["reasoning"], input["reasoning_effort"]);

  try {
    request.system.push(...decodeOpenAIBlocks(input["instructions"]));
  } catch (error) {
    throw new ProtocolError(`instructions: ${(error as Error).message}`);
  }

  const value = input["input"];
  if (typeof value === "string") {
    request.messages.push({
      role: "user",
      blocks: [{ ...emptyBlock("text"), text: value }],
    });
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (!isPlainObject(item)) {
        throw new ProtocolError(`input[${i}] must be an object`);
      }
      decodeResponsesItem(request, item, i);
    }
  } else {
    throw new ProtocolError("input must be a string or array");
  }

  const rawTools = sliceAt(input, "tools");
  for (let i = 0; i < rawTools.length; i++) {
    const tool = rawTools[i];
    if (!isPlainObject(tool)) {
      throw new ProtocolError(`tools[${i}] must be an object`);
    }
    if (stringAt(tool, "type") !== "function") {
      continue;
    }
    request.tools.push(responsesTool(tool));
  }
  request.toolChoice = decodeResponsesToolChoice(input["tool_choice"]);
  request.responseFormat = mapAt(input, "text", "format");
  request.parallelToolCalls = input["parallel_tool_calls"];
  request.promptCacheKey = input["prompt_cache_key"];
  request.safetyIdentifier = input["safety_identifier"];
  request.serviceTier = input["service_tier"];
  request.store = input["store"];
}

// decodeResponsesItem folds one Responses input item into the bridge model.
function decodeResponsesItem(
  request: BridgeRequest,
  item: Record<string, unknown>,
  index: number,
): void {
  switch (stringAt(item, "type")) {
    case "reasoning":
      for (const block of decodeResponsesReasoning(item)) {
        appendBridgeBlock(request.messages, "assistant", block);
      }
      return;
    case "function_call": {
      const block = emptyBlock("tool_call");
      block.id = firstString(stringAt(item, "call_id"), stringAt(item, "id"));
      block.name = stringAt(item, "name");
      block.argumentsJSON = stringAt(item, "arguments");
      appendBridgeBlock(request.messages, "assistant", block);
      return;
    }
    case "function_call_output": {
      const block = emptyBlock("tool_result");
      block.callId = stringAt(item, "call_id");
      block.result = item["output"];
      appendBridgeBlock(request.messages, "user", block);
      return;
    }
    case "message":
    case "": {
      const role = stringAt(item, "role");
      let blocks: BridgeBlock[];
      try {
        blocks = decodeOpenAIBlocks(item["content"]);
      } catch (error) {
        throw new ProtocolError(`input[${index}]: ${(error as Error).message}`);
      }
      if (role === "system") {
        request.system.push(...blocks);
      } else if (role === "developer") {
        request.developer.push(...blocks);
      } else if (role === "user" || role === "assistant") {
        request.messages.push({ role, blocks });
      }
      return;
    }
    default:
      throw new ProtocolError(
        `input[${index}] has unsupported Responses item type ${JSON.stringify(stringAt(item, "type"))}`,
      );
  }
}

// responsesTool reads a Responses function tool onto the bridge.
function responsesTool(tool: Record<string, unknown>): BridgeTool {
  return {
    name: stringAt(tool, "name"),
    description: stringAt(tool, "description"),
    schema: tool["parameters"],
    strict: boolAt(tool, "strict") ?? false,
  };
}
