import type {
  BridgeRequest,
  BridgeTool,
  BridgeToolChoice,
} from "../types/inference.js";
import { boolAt, isPlainObject } from "./json-util.js";
import { ProtocolError } from "./error.js";
import { decodeToolImages } from "./tool-images.js";
import { decodeChatRequest } from "./decode-request-chat.js";
import { decodeResponsesRequest } from "./decode-request-responses.js";
import { decodeAnthropicRequest } from "./decode-request-anthropic.js";
import { emptyToolChoice } from "./decode-request-shared.js";

export { emptyToolChoice };

// decodeBridgeRequest decodes a client request body of the given protocol into
// the bridge model.
export function decodeBridgeRequest(
  protocol: string,
  input: Record<string, unknown>,
): BridgeRequest {
  const request: BridgeRequest = {
    model: stringOrEmpty(input["model"]),
    system: [],
    developer: [],
    messages: [],
    tools: [],
    toolChoice: emptyToolChoice(),
    stream: boolAt(input, "stream") ?? false,
    temperature: input["temperature"],
    topP: input["top_p"],
    maxTokens: undefined,
    stop: undefined,
    reasoning: undefined,
    metadata: input["metadata"],
    responseFormat: undefined,
    parallelToolCalls: undefined,
    frequencyPenalty: undefined,
    presencePenalty: undefined,
    seed: undefined,
    promptCacheKey: undefined,
    safetyIdentifier: undefined,
    serviceTier: undefined,
    store: undefined,
  };

  switch (protocol) {
    case "chat":
      decodeChatRequest(request, input);
      break;
    case "responses":
      decodeResponsesRequest(request, input);
      break;
    case "anthropic":
      decodeAnthropicRequest(request, input);
      break;
    default:
      throw new ProtocolError(
        `unsupported input protocol ${JSON.stringify(protocol)}`,
      );
  }

  applyToolImages(request, protocol);
  return request;
}

// applyToolImages decodes the images a tool result carries. Only the
// protocols that can carry images do, and a result with an image needs the
// call ID it belongs to.
function applyToolImages(request: BridgeRequest, protocol: string): void {
  if (protocol === "chat") {
    return;
  }
  for (let i = 0; i < request.messages.length; i++) {
    const message = request.messages[i];
    if (message === undefined) {
      continue;
    }
    const blocks = message.blocks;
    for (let j = 0; j < blocks.length; j++) {
      const block = blocks[j];
      if (block === undefined || block.kind !== "tool_result") {
        continue;
      }
      const result = decodeToolImages(protocol, block.result);
      if (
        Array.isArray(result) &&
        result.every((item) => isPlainObject(item) && "kind" in item) &&
        block.callId === ""
      ) {
        throw new ProtocolError(
          `messages[${i}]: tool image result requires a call ID`,
        );
      }
      blocks[j] = { ...block, result };
    }
  }
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type { BridgeTool, BridgeToolChoice };
