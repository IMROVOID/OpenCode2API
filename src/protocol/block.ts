import type { BridgeBlock, BlockKind } from "../types/inference.js";

export const ANTHROPIC_REDACTED_THINKING_PLACEHOLDER = "[redacted thinking]";

export function emptyBlock(kind: BlockKind): BridgeBlock {
  return {
    kind,
    text: "",
    signature: "",
    encrypted: "",
    url: "",
    mediaType: "",
    data: "",
    fileId: "",
    filename: "",
    id: "",
    name: "",
    arguments: undefined,
    argumentsJSON: "",
    callId: "",
    result: undefined,
    isError: false,
  };
}

export function withText(block: BridgeBlock, text: string): BridgeBlock {
  return { ...block, text };
}

export function withURL(block: BridgeBlock, url: string): BridgeBlock {
  return { ...block, url };
}

export function isBridgeBlockArray(value: unknown[]): value is BridgeBlock[] {
  return value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as BridgeBlock).kind === "string",
  );
}

export function parseJSONOrStringValue(value: string): unknown {
  if (value === "") {
    return undefined;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
