import type { BridgeBlock } from "../types/inference.js";
import { isPlainObject, mapAt, stringAt } from "./json-util.js";
import { ProtocolError } from "./error.js";
import { emptyBlock } from "./block.js";
import {
  bridgeArgumentsJSON,
  bridgeToolResultContent,
} from "./encode-blocks.js";
import { decodeAnthropicBlocks, decodeOpenAIBlocks } from "./decode-blocks.js";

// decodeToolImages parses a Responses or Anthropic tool result that carries
// images into bridge blocks, so the images can be re-encoded for a target
// protocol whose tool result holds them differently. A result without images
// is returned unchanged.
export function decodeToolImages(
  from: string,
  value: unknown,
): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  const anthropic = from === "anthropic";
  const imageType = anthropic ? "image" : "input_image";
  const textType = anthropic ? "text" : "input_text";
  const hasImage = value.some(
    (part) => isPlainObject(part) && part["type"] === imageType,
  );
  if (!hasImage) {
    return value;
  }
  for (let i = 0; i < value.length; i++) {
    const part = value[i];
    if (!isPlainObject(part)) {
      throw new ProtocolError(`content[${i}] must be an object`);
    }
    const type = part["type"];
    if (type === textType) {
      if (typeof part["text"] !== "string") {
        throw new ProtocolError(`content[${i}] requires text`);
      }
      continue;
    }
    if (type === imageType) {
      if (anthropic) {
        if (!validAnthropicImageSource(mapAt(part, "source"))) {
          throw new ProtocolError(
            `content[${i}] has an unsupported or conflicting image source`,
          );
        }
      } else if (stringAt(part, "image_url") === "" || part["file_id"] !== undefined) {
        throw new ProtocolError(
          `content[${i}] requires an image URL without a file reference`,
        );
      }
      continue;
    }
    throw new ProtocolError(
      `content[${i}] contains an unsupported block alongside tool images`,
    );
  }
  if (anthropic) {
    return decodeAnthropicBlocks(value);
  }
  const blocks = decodeOpenAIBlocks(value);
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block === undefined || block.kind !== "image" || !block.url.startsWith("data:")) {
      continue;
    }
    const parsed = splitDataURI(block.url);
    if (!parsed) {
      throw new ProtocolError(`content[${i}] has an invalid image data URI`);
    }
    block.url = "";
    block.mediaType = parsed.mediaType;
    block.data = parsed.data;
  }
  return blocks;
}

function validAnthropicImageSource(source: Record<string, unknown>): boolean {
  const type = stringAt(source, "type");
  if (type === "url") {
    return (
      stringAt(source, "url") !== "" &&
      source["data"] === undefined &&
      source["file_id"] === undefined
    );
  }
  if (type === "base64") {
    return (
      stringAt(source, "data") !== "" &&
      stringAt(source, "media_type").startsWith("image/") &&
      source["url"] === undefined &&
      source["file_id"] === undefined
    );
  }
  return false;
}

function splitDataURI(
  url: string,
): { mediaType: string; data: string } | undefined {
  const rest = url.slice("data:".length);
  const comma = rest.indexOf(",");
  if (comma < 0) {
    return undefined;
  }
  const header = rest.slice(0, comma);
  const data = rest.slice(comma + 1);
  if (!header.endsWith(";base64")) {
    return undefined;
  }
  const mediaType = header.slice(0, header.length - ";base64".length);
  if (!mediaType.startsWith("image/") || data === "") {
    return undefined;
  }
  return { mediaType, data };
}

// chatToolImages splits a tool result that decodeToolImages parsed into the
// text a Chat tool message can hold and the image parts that must be sent in a
// separate user message.
export function chatToolImages(result: BridgeBlock): {
  text: string;
  images: BridgeBlock[];
} {
  if (!Array.isArray(result.result) || !isBridgeBlockList(result.result)) {
    return { text: bridgeToolResultContent(result.result), images: [] };
  }
  let text = "";
  const images: BridgeBlock[] = [];
  let n = 0;
  for (const part of result.result) {
    if (part.kind === "text") {
      text += part.text;
      continue;
    }
    n++;
    const marker = `[tool_image call_id=${JSON.stringify(result.callId)} index=${n}]`;
    text += `\n${marker}\n`;
    images.push({ ...emptyBlock("text"), text: marker }, part);
  }
  return { text, images };
}

// responsesToolContent renders a parsed tool result as Responses
// function_call_output content.
export function responsesToolContent(value: unknown): unknown {
  if (!Array.isArray(value) || !isBridgeBlockList(value)) {
    return bridgeToolResultContent(value);
  }
  const content: unknown[] = [];
  for (const part of value) {
    if (part.kind === "text") {
      content.push({ type: "input_text", text: part.text });
      continue;
    }
    let url = part.url;
    if (url === "") {
      url = `data:${part.mediaType};base64,${part.data}`;
    }
    content.push({ type: "input_image", image_url: url });
  }
  return content;
}

function isBridgeBlockList(value: unknown[]): value is BridgeBlock[] {
  return value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as BridgeBlock).kind === "string",
  );
}

export { bridgeArgumentsJSON };
