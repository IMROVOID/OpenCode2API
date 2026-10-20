import type { BridgeBlock, BridgeRequest, BridgeTool } from "../types/inference.js";
import { isPlainObject, sliceAt, stringAt } from "./json-util.js";
import { ProtocolError } from "./error.js";
import { decodeAnthropicBlocks } from "./decode-blocks.js";
import { anthropicReasoning } from "./decode-reasoning.js";
import { decodeAnthropicToolChoice } from "./decode-request-shared.js";

// decodeAnthropicRequest decodes an Anthropic Messages request onto the
// bridge model.
export function decodeAnthropicRequest(
  request: BridgeRequest,
  input: Record<string, unknown>,
): void {
  request.maxTokens = input["max_tokens"];
  request.stop = input["stop_sequences"];
  request.reasoning = anthropicReasoning(input);

  try {
    request.system = decodeAnthropicBlocks(input["system"]);
  } catch (error) {
    throw new ProtocolError(`system: ${(error as Error).message}`);
  }

  const rawMessages = sliceAt(input, "messages");
  for (let i = 0; i < rawMessages.length; i++) {
    const message = rawMessages[i];
    if (!isPlainObject(message)) {
      throw new ProtocolError(`messages[${i}] must be an object`);
    }
    const role = stringAt(message, "role");
    if (role === "system" || role === "developer") {
      const blocks = decodeMessageBlocks(message, i);
      if (role === "system") {
        request.system.push(...blocks);
      } else {
        request.developer.push(...blocks);
      }
      continue;
    }
    if (role !== "user" && role !== "assistant") {
      throw new ProtocolError(
        `messages[${i}] has unsupported role ${JSON.stringify(role)}`,
      );
    }
    request.messages.push({ role, blocks: decodeMessageBlocks(message, i) });
  }

  const rawTools = sliceAt(input, "tools");
  for (let i = 0; i < rawTools.length; i++) {
    const tool = rawTools[i];
    if (!isPlainObject(tool)) {
      throw new ProtocolError(`tools[${i}] must be an object`);
    }
    request.tools.push(anthropicTool(tool));
  }
  request.toolChoice = decodeAnthropicToolChoice(input["tool_choice"]);
}

// decodeMessageBlocks decodes one Anthropic message's content blocks.
function decodeMessageBlocks(
  message: Record<string, unknown>,
  index: number,
): BridgeBlock[] {
  try {
    return decodeAnthropicBlocks(message["content"]);
  } catch (error) {
    throw new ProtocolError(`messages[${index}]: ${(error as Error).message}`);
  }
}

// anthropicTool reads an Anthropic tool onto the bridge.
function anthropicTool(tool: Record<string, unknown>): BridgeTool {
  return {
    name: stringAt(tool, "name"),
    description: stringAt(tool, "description"),
    schema: tool["input_schema"],
    strict: false,
  };
}
