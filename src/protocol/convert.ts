import { decodeBridgeRequest } from "./decode-request.js";
import { encodeBridgeRequest, validateBridgeRequest } from "./encode-request.js";
import { floorResponsesMaxTokens } from "./encode-shared.js";
import { normalizeToolReasoningHistory } from "./reasoning-history.js";
import { put } from "./json-util.js";

// convertRequest renders a client request body in the protocol the upstream
// speaks.
//
// A request that already uses the target protocol is cloned unchanged, so
// provider-specific fields the bridge does not model survive; a request in
// another protocol is decoded into the bridge model and re-encoded.
export function convertRequest(
  from: string,
  to: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (from === to) {
    return structuredClone(input);
  }
  const request = decodeBridgeRequest(from, input);
  validateBridgeRequest(to, request);
  return encodeBridgeRequest(to, request);
}

// prepareRequest is the single request preparation path for both pass-through
// and transcoded requests.
//
// It converts the body, floors the Responses output budget, and repairs the
// reasoning history of assistant tool-call turns for the endpoints that
// require reasoning replay.
export function prepareRequest(
  from: string,
  to: string,
  input: Record<string, unknown>,
  upstreamURL: string,
): Record<string, unknown> {
  const output = convertRequest(from, to, input);
  if (to === "responses") {
    put(
      output,
      "max_output_tokens",
      floorResponsesMaxTokens(output["max_output_tokens"]),
    );
  }
  normalizeToolReasoningHistory(
    to,
    typeof output["model"] === "string" ? output["model"] : "",
    upstreamURL,
    output,
  );
  return output;
}
