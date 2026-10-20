import type { BridgeStreamEvent } from "./stream-types.js";

// ProtocolStreamParser turns one upstream protocol's SSE payload into bridge
// stream events.
export interface ProtocolStreamParser {
  parse(eventName: string, value: Record<string, unknown>): BridgeStreamEvent[];
}
