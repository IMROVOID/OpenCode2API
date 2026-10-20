import type { BridgeRequest } from "../types/inference.js";
import { ProtocolError } from "./error.js";
import { encodeChatRequest } from "./encode-chat.js";
import { encodeResponsesRequest } from "./encode-responses.js";
import { encodeAnthropicRequest } from "./encode-anthropic.js";
import { isPlainObject } from "./json-util.js";

// encodeBridgeRequest renders a bridge request in the given protocol.
export function encodeBridgeRequest(
  protocol: string,
  request: BridgeRequest,
): Record<string, unknown> {
  switch (protocol) {
    case "chat":
      return encodeChatRequest(request);
    case "responses":
      return encodeResponsesRequest(request);
    case "anthropic":
      return encodeAnthropicRequest(request);
    default:
      throw new ProtocolError(
        `unsupported output protocol ${JSON.stringify(protocol)}`,
      );
  }
}

// validateBridgeRequest rejects a bridge request that no protocol can express.
//
// A file in a system block is meaningless once the system prompt is flattened
// into text, and a file that is known only by an upstream file id cannot be
// replayed to an endpoint that does not know that id.
export function validateBridgeRequest(
  protocol: string,
  request: BridgeRequest,
): void {
  const system = [...request.system, ...request.developer];
  for (const block of system) {
    if (block.kind !== "file") {
      continue;
    }
    if (protocol === "responses") {
      throw new ProtocolError(
        "system blocks cannot contain a file for the responses protocol",
      );
    }
    if (block.fileId !== "" && block.data === "" && block.url === "") {
      throw new ProtocolError(
        `file ${JSON.stringify(block.fileId)} is only known by an upstream file id`,
      );
    }
  }
}

// isPlainObjectMap is a narrow guard for the object-shaped request bodies the
// proxy accepts.
export function isPlainObjectMap(
  value: unknown,
): value is Record<string, unknown> {
  return isPlainObject(value);
}
