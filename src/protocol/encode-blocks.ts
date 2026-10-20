import type { BridgeBlock } from "../types/inference.js";
import { firstString, isPlainObject, put } from "./json-util.js";
import { isBridgeBlockArray, parseJSONOrStringValue } from "./block.js";
import { ANTHROPIC_REDACTED_THINKING_PLACEHOLDER } from "./block.js";

// bridgeReasoningText joins reasoning blocks into the single text Chat's
// reasoning_content holds, using a placeholder for a block that carries only
// encrypted content.
export function bridgeReasoningText(
  blocks: BridgeBlock[],
): { text: string; ok: boolean } {
  if (blocks.length === 0) {
    return { text: "", ok: false };
  }
  let text = "";
  for (const block of blocks) {
    if (block.text !== "") {
      text += block.text;
    } else if (block.encrypted !== "") {
      text += ANTHROPIC_REDACTED_THINKING_PLACEHOLDER;
    }
  }
  return { text, ok: true };
}

// bridgeReasoningSignature returns the signature of the last signed reasoning
// block, or "" when no block is signed.
export function bridgeReasoningSignature(blocks: BridgeBlock[]): string {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block !== undefined && block.signature !== "") {
      return block.signature;
    }
  }
  return "";
}

// encodeChatBlocks renders blocks as Chat message content: a lone text block
// becomes a plain string and anything else an array of text, image_url and
// file parts.
export function encodeChatBlocks(blocks: BridgeBlock[]): unknown {
  const only = blocks.length === 1 ? blocks[0] : undefined;
  if (only !== undefined && only.kind === "text") {
    return only.text;
  }
  const parts: unknown[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "text":
        parts.push({ type: "text", text: block.text });
        break;
      case "image": {
        let url = block.url;
        if (url === "" && block.data !== "") {
          url = `data:${block.mediaType};base64,${block.data}`;
        }
        parts.push({ type: "image_url", image_url: { url } });
        break;
      }
      case "file": {
        const file: Record<string, unknown> = {};
        put(file, "file_id", block.fileId);
        put(file, "file_data", block.data);
        put(file, "filename", block.filename);
        parts.push({ type: "file", file });
        break;
      }
      default:
        break;
    }
  }
  return parts;
}

// encodeAnthropicBlocks renders blocks as Anthropic content blocks.
export function encodeAnthropicBlocks(blocks: BridgeBlock[]): unknown[] {
  const parts: unknown[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "text":
        parts.push({ type: "text", text: block.text });
        break;
      case "image":
        if (block.url !== "") {
          parts.push({
            type: "image",
            source: { type: "url", url: block.url },
          });
        } else {
          parts.push({
            type: "image",
            source: {
              type: "base64",
              media_type: block.mediaType,
              data: block.data,
            },
          });
        }
        break;
      case "file": {
        let source: Record<string, unknown> | undefined;
        if (block.url !== "") {
          source = { type: "url", url: block.url };
        } else if (block.data !== "") {
          source = {
            type: "base64",
            media_type: firstString(block.mediaType, "application/octet-stream"),
            data: block.data,
          };
        }
        if (source) {
          const part: Record<string, unknown> = { type: "document", source };
          put(part, "title", block.filename);
          parts.push(part);
        }
        break;
      }
      case "tool_call": {
        const input =
          block.arguments === undefined || block.arguments === null
            ? parseJSONOrStringValue(block.argumentsJSON)
            : block.arguments;
        parts.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input,
        });
        break;
      }
      case "tool_result": {
        let content = block.result;
        if (Array.isArray(content) && isBridgeBlockArray(content)) {
          content = encodeAnthropicBlocks(content);
        }
        parts.push({
          type: "tool_result",
          tool_use_id: block.callId,
          content,
          is_error: block.isError,
        });
        break;
      }
      case "reasoning": {
        if (block.encrypted !== "") {
          parts.push({ type: "redacted_thinking", data: block.encrypted });
          break;
        }
        parts.push({
          type: "thinking",
          thinking: block.text,
          signature: block.signature,
        });
        break;
      }
      default:
        break;
    }
  }
  return parts;
}

// bridgeArgumentsJSON returns a tool call's arguments as JSON text.
export function bridgeArgumentsJSON(block: BridgeBlock): string {
  if (block.argumentsJSON !== "") {
    return block.argumentsJSON;
  }
  if (block.arguments === undefined || block.arguments === null) {
    return "{}";
  }
  try {
    return JSON.stringify(block.arguments);
  } catch {
    return "{}";
  }
}

// bridgeToolResultContent flattens a tool result into a string.
export function bridgeToolResultContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    let text = "";
    let allText = true;
    for (const raw of value) {
      if (!isPlainObject(raw) || (raw as Record<string, unknown>)["type"] !== "text") {
        allText = false;
        break;
      }
      text += typeof raw["text"] === "string" ? (raw["text"] as string) : "";
    }
    if (allText) {
      return text;
    }
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

// bridgeBlocksText concatenates the text of the "text" blocks and ignores
// every other kind.
export function bridgeBlocksText(blocks: BridgeBlock[]): string {
  let text = "";
  for (const block of blocks) {
    if (block.kind === "text") {
      text += block.text;
    }
  }
  return text;
}
