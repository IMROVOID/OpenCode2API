import type { BridgeBlock } from "../types/inference.js";
import {
  boolAt,
  firstString,
  isPlainObject,
  mapAt,
  stringAt,
} from "./json-util.js";
import { emptyBlock, withText, withURL } from "./block.js";
import { ProtocolError } from "./error.js";

// decodeOpenAIBlocks decodes Chat or Responses content into bridge blocks. It
// accepts a plain string, a single part object or an array of parts; null and
// "" decode to no blocks. Any other part type is an error rather than being
// dropped.
export function decodeOpenAIBlocks(value: unknown): BridgeBlock[] {
  if (typeof value === "string") {
    return value === "" ? [] : [withText(emptyBlock("text"), value)];
  }
  if (isPlainObject(value)) {
    return decodeOpenAIBlocks([value]);
  }
  if (Array.isArray(value)) {
    const blocks: BridgeBlock[] = [];
    for (const raw of value) {
      if (!isPlainObject(raw)) {
        throw new ProtocolError("OpenAI content block must be an object");
      }
      const type = stringAt(raw, "type");
      switch (type) {
        case "text":
        case "input_text":
        case "output_text":
          blocks.push(withText(emptyBlock("text"), stringAt(raw, "text")));
          break;
        case "image_url":
          blocks.push(
            withURL(
              emptyBlock("image"),
              firstString(
                stringAt(raw, "image_url", "url"),
                stringAt(raw, "image_url"),
              ),
            ),
          );
          break;
        case "input_image":
          blocks.push(withURL(emptyBlock("image"), stringAt(raw, "image_url")));
          break;
        case "file":
        case "input_file": {
          const file = mapAt(raw, "file");
          const block = emptyBlock("file");
          block.fileId = firstString(
            stringAt(raw, "file_id"),
            stringAt(file, "file_id"),
          );
          block.filename = firstString(
            stringAt(raw, "filename"),
            stringAt(file, "filename"),
          );
          block.mediaType = firstString(
            stringAt(raw, "media_type"),
            stringAt(file, "media_type"),
          );
          block.data = firstString(
            stringAt(raw, "file_data"),
            stringAt(file, "file_data"),
          );
          blocks.push(block);
          break;
        }
        default:
          throw new ProtocolError(
            `unsupported OpenAI content block type ${JSON.stringify(type)}`,
          );
      }
    }
    return blocks;
  }
  if (value === undefined || value === null) {
    return [];
  }
  throw new ProtocolError("unsupported OpenAI content value");
}

// decodeAnthropicBlocks decodes Anthropic content (a string, a single block or
// an array of blocks) into bridge blocks. thinking and redacted_thinking
// become reasoning blocks, a text document becomes plain text and any other
// document a file, and an unknown block type is an error.
export function decodeAnthropicBlocks(value: unknown): BridgeBlock[] {
  if (typeof value === "string") {
    return value === "" ? [] : [withText(emptyBlock("text"), value)];
  }
  const blocks: BridgeBlock[] = [];
  for (const raw of asBlocks(value)) {
    if (!isPlainObject(raw)) {
      throw new ProtocolError("Anthropic content block must be an object");
    }
    const type = stringAt(raw, "type");
    switch (type) {
      case "thinking": {
        const block = emptyBlock("reasoning");
        block.text = stringAt(raw, "thinking");
        block.signature = stringAt(raw, "signature");
        blocks.push(block);
        break;
      }
      case "redacted_thinking": {
        const block = emptyBlock("reasoning");
        block.encrypted = stringAt(raw, "data");
        blocks.push(block);
        break;
      }
      case "text":
        blocks.push(withText(emptyBlock("text"), stringAt(raw, "text")));
        break;
      case "image": {
        const source = mapAt(raw, "source");
        const block = emptyBlock("image");
        if (stringAt(source, "type") === "url") {
          block.url = stringAt(source, "url");
        } else {
          block.mediaType = stringAt(source, "media_type");
          block.data = stringAt(source, "data");
        }
        blocks.push(block);
        break;
      }
      case "document": {
        const source = mapAt(raw, "source");
        if (stringAt(source, "type") === "text") {
          blocks.push(
            withText(
              emptyBlock("text"),
              firstString(stringAt(source, "data"), stringAt(source, "text")),
            ),
          );
          break;
        }
        const block = emptyBlock("file");
        block.url = stringAt(source, "url");
        block.mediaType = stringAt(source, "media_type");
        block.data = firstString(
          stringAt(source, "data"),
          stringAt(source, "text"),
        );
        block.filename = stringAt(raw, "title");
        blocks.push(block);
        break;
      }
      case "tool_use": {
        const block = emptyBlock("tool_call");
        block.id = stringAt(raw, "id");
        block.name = stringAt(raw, "name");
        block.arguments = raw["input"];
        blocks.push(block);
        break;
      }
      case "tool_result": {
        const block = emptyBlock("tool_result");
        block.callId = stringAt(raw, "tool_use_id");
        block.result = raw["content"];
        block.isError = boolAt(raw, "is_error") ?? false;
        blocks.push(block);
        break;
      }
      default:
        throw new ProtocolError(
          `unsupported Anthropic content block type ${JSON.stringify(type)}`,
        );
    }
  }
  return blocks;
}

// asBlocks returns the value as an array of parts, promoting a single part.
function asBlocks(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
