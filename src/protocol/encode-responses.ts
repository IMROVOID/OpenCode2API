import type { BridgeRequest } from "../types/inference.js";
import { put } from "./json-util.js";
import { bridgeArgumentsJSON, bridgeBlocksText } from "./encode-blocks.js";
import { responsesToolContent } from "./tool-images.js";
import { responsesReasoning } from "./reasoning.js";
import {
  encodeResponsesReasoningInput,
  encodeResponsesToolChoice,
  floorResponsesMaxTokens,
  normalizeResponsesRole,
  responsesTextFormat,
  schemaOrDefault,
} from "./encode-shared.js";

// encodeResponsesRequest encodes a bridge request as a Responses body.
//
// Instructions come from the system blocks and a leading developer message
// from the developer blocks. Each message becomes one or more input items:
// reasoning blocks become reasoning items (only when they carry a server-issued
// ID or encrypted content), text and images become content parts, files
// input_file parts, and tool calls and results standalone function_call and
// function_call_output items.
export function encodeResponsesRequest(
  request: BridgeRequest,
): Record<string, unknown> {
  const output: Record<string, unknown> = {
    model: request.model,
    stream: request.stream,
  };
  put(output, "temperature", request.temperature);
  put(output, "top_p", request.topP);
  put(output, "max_output_tokens", floorResponsesMaxTokens(request.maxTokens));
  put(output, "stop", request.stop);
  put(output, "metadata", request.metadata);
  if (request.system.length > 0) {
    output["instructions"] = bridgeBlocksText(request.system);
  }
  if (request.reasoning !== undefined && request.reasoning !== null) {
    const reasoning = responsesReasoning(request.reasoning);
    if (reasoning !== undefined && reasoning !== null) {
      output["reasoning"] = reasoning;
    }
  }
  const format = responsesTextFormat(request.responseFormat);
  if (format !== undefined) {
    output["text"] = { format };
  }
  put(output, "parallel_tool_calls", request.parallelToolCalls);
  put(output, "prompt_cache_key", request.promptCacheKey);
  put(output, "safety_identifier", request.safetyIdentifier);
  put(output, "service_tier", request.serviceTier);
  put(output, "store", request.store);

  const items: unknown[] = [];
  if (request.developer.length > 0) {
    items.push({
      type: "message",
      role: "developer",
      content: [
        { type: "input_text", text: bridgeBlocksText(request.developer) },
      ],
    });
  }
  for (const message of request.messages) {
    let content: unknown[] = [];
    const flushContent = (): void => {
      if (content.length === 0) {
        return;
      }
      items.push({
        type: "message",
        role: normalizeResponsesRole(message.role),
        content,
      });
      content = [];
    };
    for (const block of message.blocks) {
      switch (block.kind) {
        case "reasoning": {
          flushContent();
          const encoded = encodeResponsesReasoningInput(block);
          if (encoded.ok) {
            items.push(encoded.item);
          }
          break;
        }
        case "text": {
          const kind = message.role === "assistant" ? "output_text" : "input_text";
          content.push({ type: kind, text: block.text });
          break;
        }
        case "image": {
          let url = block.url;
          if (url === "" && block.data !== "") {
            url = `data:${block.mediaType};base64,${block.data}`;
          }
          content.push({ type: "input_image", image_url: url });
          break;
        }
        case "file": {
          const item: Record<string, unknown> = { type: "input_file" };
          put(item, "file_id", block.fileId);
          put(item, "file_data", block.data);
          put(item, "filename", block.filename);
          content.push(item);
          break;
        }
        case "tool_call": {
          flushContent();
          items.push({
            type: "function_call",
            call_id: block.id,
            name: block.name,
            arguments: bridgeArgumentsJSON(block),
          });
          break;
        }
        case "tool_result": {
          flushContent();
          items.push({
            type: "function_call_output",
            call_id: block.callId,
            output: responsesToolContent(block.result),
          });
          break;
        }
        default:
          break;
      }
    }
    flushContent();
  }
  output["input"] = items;

  if (request.tools.length > 0) {
    const tools = request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: schemaOrDefault(tool.schema),
      strict: tool.strict,
    }));
    output["tools"] = tools;
    const choice = encodeResponsesToolChoice(request.toolChoice);
    if (choice !== undefined) {
      output["tool_choice"] = choice;
    }
  }
  return output;
}
