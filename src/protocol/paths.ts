import type { Protocol } from "../types/config.js";

// protocolPath returns the endpoint path that serves a protocol, relative to
// an API base. The gateway's own routes and the upstream endpoints share these
// paths. An unknown protocol gets the Chat path.
export function protocolPath(protocol: Protocol): string {
  switch (protocol) {
    case "responses":
      return "/v1/responses";
    case "anthropic":
      return "/v1/messages";
    case "systemone":
      return "/v1/systemone";
    default:
      return "/v1/chat/completions";
  }
}

// isValidProtocol reports whether the protocol is one the gateway serves.
export function isValidProtocol(protocol: string): protocol is Protocol {
  return (
    protocol === "chat" ||
    protocol === "responses" ||
    protocol === "anthropic" ||
    protocol === "systemone"
  );
}
