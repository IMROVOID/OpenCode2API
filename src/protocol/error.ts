export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

export type ProtocolErrorKind =
  | "invalid_request_error"
  | "authentication_error"
  | "client_canceled"
  | "proxy_error"
  | "upstream_timeout"
  | "upstream_error"
  | "rotation_unavailable"
  | "server_error";

export interface ErrorEnvelope {
  status: number;
  body: Record<string, unknown>;
}

// buildErrorEnvelope renders the error body in the shape the protocol's clients
// expect: {"type":"error","error":{...}} for Anthropic, and the OpenAI
// {"error":{message,type,param,code}} shape for every other protocol.
export function buildErrorEnvelope(
  protocol: string,
  status: number,
  message: string,
  kind: ProtocolErrorKind,
): ErrorEnvelope {
  if (protocol === "anthropic") {
    return {
      status,
      body: { type: "error", error: { type: kind, message } },
    };
  }
  return {
    status,
    body: {
      error: { message, type: kind, param: null, code: null },
    },
  };
}
