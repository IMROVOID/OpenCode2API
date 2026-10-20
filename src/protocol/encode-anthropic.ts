import type { BridgeRequest } from "../types/inference.js";
import { put } from "./json-util.js";
import { encodeAnthropicBlocks } from "./encode-blocks.js";
import { anthropicThinking } from "./reasoning.js";
import {
  encodeAnthropicToolChoice,
  schemaOrDefault,
} from "./encode-shared.js";

const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;

// encodeAnthropicRequest encodes a bridge request as an Anthropic Messages
// body.
//
// System and developer blocks are merged into one system prompt, a missing
// max_tokens defaults to 4096, and adjacent same-role messages are joined into
// one, because Anthropic expects the turns to alternate. A "none" tool choice
// omits the tools entirely, since Anthropic cannot express it.
export function encodeAnthropicRequest(
  request: BridgeRequest,
): Record<string, unknown> {
  const output: Record<string, unknown> = {
    model: request.model,
    stream: request.stream,
  };
  put(output, "temperature", request.temperature);
  put(output, "top_p", request.topP);
  put(output, "stop_sequences", request.stop);
  output["max_tokens"] =
    request.maxTokens === undefined || request.maxTokens === null
      ? DEFAULT_ANTHROPIC_MAX_TOKENS
      : request.maxTokens;

  const thinking = anthropicThinking(request.reasoning);
  if (thinking.thinking) {
    output["thinking"] = thinking.thinking;
    if (thinking.outputConfig) {
      output["output_config"] = thinking.outputConfig;
    }
  }
  if (request.system.length > 0 || request.developer.length > 0) {
    const instructions = [...request.system, ...request.developer];
    output["system"] = encodeAnthropicBlocks(instructions);
  }

  const messages: Record<string, unknown>[] = [];
  for (const message of request.messages) {
    const content = encodeAnthropicBlocks(message.blocks);
    if (content.length === 0) {
      continue;
    }
    const role = message.role === "assistant" ? "assistant" : "user";
    const last = messages[messages.length - 1];
    if (last && last["role"] === role) {
      const previous = last["content"];
      const merged = Array.isArray(previous) ? previous : [];
      last["content"] = [...merged, ...content];
      continue;
    }
    messages.push({ role, content });
  }
  output["messages"] = messages;

  if (request.tools.length > 0 && request.toolChoice.mode !== "none") {
    const tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: schemaOrDefault(tool.schema),
    }));
    output["tools"] = tools;
    const choice = encodeAnthropicToolChoice(request.toolChoice);
    if (choice !== undefined) {
      output["tool_choice"] = choice;
    }
  }
  return output;
}
