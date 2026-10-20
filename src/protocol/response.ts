import type { BridgeResponse } from "../types/inference.js";
import { isPlainObject, sliceAt, stringAt } from "./json-util.js";
import { ProtocolError } from "./error.js";
import { decodeBridgeResponse } from "./response-decode.js";
import { encodeBridgeResponse } from "./response-encode.js";

// convertResponse converts a serialized response body from one protocol to
// another. A same-protocol body is returned unchanged; otherwise the body is
// decoded into the bridge model and re-encoded for the target. An upstream
// error envelope becomes an error, and so does a body the target protocol
// cannot represent.
export function convertResponse(
  from: string,
  to: string,
  body: string,
): string {
  if (from === to) {
    return body;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (error) {
    throw new ProtocolError(
      `invalid upstream response JSON: ${(error as Error).message}`,
    );
  }
  if (!isPlainObject(parsed)) {
    throw new ProtocolError("upstream response must be a JSON object");
  }
  const response = decodeBridgeResponse(from, parsed);
  if (response.error !== "" || response.stop === "error") {
    throw new ProtocolError(
      `upstream response failed: ${response.error !== "" ? response.error : "upstream response failed"}`,
    );
  }
  return JSON.stringify(encodeBridgeResponse(to, response));
}

// renameResponseTool rewrites tool call names matching fromName to toName
// inside a serialized JSON response or SSE event data object for the given
// protocol. It restores a client's original read-related tool name after the
// v1 lane's shaper aliased it to "read" on the outbound wire.
export function renameResponseTool(
  body: string,
  protocol: string,
  fromName: string,
  toName: string,
): string {
  if (fromName === "" || toName === "" || fromName === toName || body === "") {
    return body;
  }
  if (!body.includes(fromName)) {
    return body;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return body;
  }
  if (!isPlainObject(parsed)) {
    return body;
  }
  if (!renameToolInMap(parsed, protocol, fromName, toName)) {
    return body;
  }
  return JSON.stringify(parsed);
}

// renameToolInMap rewrites matching tool names in a decoded response or stream
// event and reports whether anything changed. Every place a protocol reports a
// tool call is visited.
function renameToolInMap(
  payload: Record<string, unknown>,
  protocol: string,
  fromName: string,
  toName: string,
): boolean {
  let changed = false;
  switch (protocol) {
    case "chat": {
      for (const rawChoice of sliceAt(payload, "choices")) {
        const choice = isPlainObject(rawChoice) ? rawChoice : {};
        for (const key of ["message", "delta"]) {
          const container = isPlainObject(choice[key]) ? choice[key] : {};
          for (const rawCall of sliceAt(container, "tool_calls")) {
            const call = isPlainObject(rawCall) ? rawCall : {};
            const fn = call["function"];
            if (isPlainObject(fn) && stringAt(fn, "name") === fromName) {
              fn["name"] = toName;
              changed = true;
            }
          }
        }
      }
      break;
    }
    case "responses": {
      const item = payload["item"];
      if (
        isPlainObject(item) &&
        stringAt(item, "type") === "function_call" &&
        stringAt(item, "name") === fromName
      ) {
        item["name"] = toName;
        changed = true;
      }
      changed =
        renameItems(sliceAt(payload, "output"), fromName, toName) || changed;
      const envelope = payload["response"];
      if (isPlainObject(envelope)) {
        changed =
          renameItems(sliceAt(envelope, "output"), fromName, toName) || changed;
      }
      break;
    }
    case "anthropic": {
      const block = payload["content_block"];
      if (
        isPlainObject(block) &&
        stringAt(block, "type") === "tool_use" &&
        stringAt(block, "name") === fromName
      ) {
        block["name"] = toName;
        changed = true;
      }
      changed =
        renameItems(sliceAt(payload, "content"), fromName, toName) || changed;
      break;
    }
    default:
      break;
  }
  return changed;
}

// renameItems rewrites the name of every tool_use or function_call item.
function renameItems(
  items: unknown[],
  fromName: string,
  toName: string,
): boolean {
  let changed = false;
  for (const raw of items) {
    const item = isPlainObject(raw) ? raw : {};
    const isTool =
      stringAt(item, "type") === "function_call" ||
      stringAt(item, "type") === "tool_use";
    if (isTool && stringAt(item, "name") === fromName) {
      item["name"] = toName;
      changed = true;
    }
  }
  return changed;
}

export type { BridgeResponse };
