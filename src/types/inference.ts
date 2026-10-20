import type { Protocol, Tier } from "./config.js";

export type BlockKind =
  | "text"
  | "image"
  | "file"
  | "reasoning"
  | "tool_call"
  | "tool_result";

export interface BridgeTool {
  name: string;
  description: string;
  schema: unknown;
  strict: boolean;
}

export interface BridgeToolChoice {
  mode: "auto" | "none" | "required" | "named" | "";
  name: string;
}

export interface BridgeBlock {
  kind: BlockKind;
  text: string;
  signature: string;
  encrypted: string;
  url: string;
  mediaType: string;
  data: string;
  fileId: string;
  filename: string;
  id: string;
  name: string;
  arguments: unknown;
  argumentsJSON: string;
  callId: string;
  result: unknown;
  isError: boolean;
}

export interface BridgeMessage {
  role: "user" | "assistant";
  blocks: BridgeBlock[];
}

export interface BridgeRequest {
  model: string;
  system: BridgeBlock[];
  developer: BridgeBlock[];
  messages: BridgeMessage[];
  tools: BridgeTool[];
  toolChoice: BridgeToolChoice;
  stream: boolean;
  temperature: unknown;
  topP: unknown;
  maxTokens: unknown;
  stop: unknown;
  reasoning: unknown;
  metadata: unknown;
  responseFormat: unknown;
  parallelToolCalls: unknown;
  frequencyPenalty: unknown;
  presencePenalty: unknown;
  seed: unknown;
  promptCacheKey: unknown;
  safetyIdentifier: unknown;
  serviceTier: unknown;
  store: unknown;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
}

// BridgeResponse is a complete (non-streaming) response in protocol-neutral
// form, as decoded from an upstream body or accumulated from a stream.
export interface BridgeResponse {
  id: string;
  model: string;
  text: string;
  reasoning: BridgeBlock[];
  tools: BridgeBlock[];
  stop: string;
  error: string;
  usage: Usage;
  created: number;
}

export interface Route {
  id: string;
  tier: Tier;
  protocol: Protocol;
  protocols: Record<Tier, Protocol>;
  anonymous: boolean;
  keyTiers: Tier[];
}

export interface ModelMetadata {
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  contextLength: number;
  maxInput: number;
  maxOutput: number;
  reasoningEfforts: string[];
  defaultReasoningEffort: string;
  nativeProtocol: Protocol;
  supportedEndpoints: string[];
}

export interface CatalogModel {
  id: string;
  zen: boolean;
  go: boolean;
  metadata?: ModelMetadata;
  free: boolean;
}

export interface UpstreamAttemptRecord {
  time: string;
  request_id: string;
  model: string;
  tier: string;
  attempt: number;
  key_id: string;
  channel: string;
  anonymous: boolean;
  proxy_node: string;
  status: number;
  duration_ms: number;
  success: boolean;
  outcome: string;
}

export type RequestOutcome =
  | "success"
  | "error"
  | "stream_error"
  | "client_canceled"
  | "rejected"
  | "retryable_failure"
  | "transport_error";

export interface RequestLogRecord {
  time: string;
  requestId: string;
  session: string;
  model: string;
  tier: string;
  protocol: string;
  status: number;
  durationMs: number;
  stream: boolean;
  outcome: RequestOutcome;
  legs: string[];
  usage?: Usage;
  usageReported: boolean;
  serverKeyId: string;
  error?: string;
}

export interface MinuteBucket {
  minute: string;
  requests: number;
  errors: number;
  success: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgDurationMs: number;
}

export interface LifetimeTotals {
  requests: number;
  errors: number;
  success: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  streams: number;
}
