import type { Usage } from "../types/inference.js";

// The latency bounds of the histogram, in milliseconds. The last bucket is
// the overflow above the final bound.
export const LATENCY_BOUNDS = [
  50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000,
] as const;

// The minimum ring size the broker keeps.
export const BUCKET_COUNT = 60;

// The capacity of the recent request and attempt buffers.
export const RECENT_REQUEST_CAPACITY = 10000;
export const RECENT_ATTEMPT_CAPACITY = 20000;

// How many entries a snapshot returns.
export const RECENT_OUTPUT_LIMIT = 500;

// The cap of the lifetime per-session token map.
export const MAX_LIFETIME_SESSIONS = 500;

// TokenCounts is a token total.
export interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
}

// ServerKeyUsage is the usage one local server key produced.
export interface ServerKeyUsage {
  requests: number;
  token_counts: TokenCounts;
}

// UsagePeriod is the usage of one period.
export interface UsagePeriod {
  requests: number;
  reported: number;
  coverage: number;
  tokens: TokenCounts;
  models: Record<string, TokenCounts>;
  tiers: Record<string, TokenCounts>;
  sessions: Record<string, TokenCounts>;
  server_keys: Record<string, ServerKeyUsage>;
}

// UsageSnapshot is the usage of the lifetime and of the last hour.
export interface UsageSnapshot {
  lifetime: UsagePeriod;
  last_hour: UsagePeriod;
}

// AttemptCounts counts the upstream attempts.
export interface AttemptCounts {
  total: number;
  success: number;
  failed: number;
}

// AttemptAggregate is the aggregate of the upstream attempts.
export interface AttemptAggregate extends AttemptCounts {
  success_rate: number;
  tiers: Record<string, AttemptCounts>;
  channels: Record<string, AttemptCounts>;
  keys: Record<string, AttemptCounts>;
}

// UpstreamAttempt is one upstream attempt.
export interface UpstreamAttempt {
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

// UpstreamRequest is one routed request.
export interface UpstreamRequest {
  time: string;
  request_id: string;
  session: string;
  server_key_id: string;
  model: string;
  tier: string;
  key_id: string;
  channel: string;
  anonymous: boolean;
  proxy_node: string;
  attempts: number;
  status: number;
  duration_ms: number;
  success: boolean;
  outcome: string;
}

// UpstreamSnapshot is the upstream activity.
export interface UpstreamSnapshot {
  lifetime: AttemptAggregate;
  last_hour: AttemptAggregate;
  requests: UpstreamRequest[];
  recent: UpstreamAttempt[];
}

// MetricSummary is the counter summary of one period.
export interface MetricSummary {
  total: number;
  success: number;
  errors: number;
  success_rate: number;
  average_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
}

// MetricSeries is one minute of the last-hour series.
export interface MetricSeries {
  minute: string;
  total: number;
  success: number;
  errors: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  usage_reported: number;
}

// MonitorSnapshot is the whole metrics state.
export interface MonitorSnapshot {
  started_at: string;
  uptime_seconds: number;
  active_requests: number;
  active_streams: number;
  lifetime: MetricSummary;
  last_hour: MetricSummary;
  series: MetricSeries[];
  endpoints: Record<string, number>;
  models: Record<string, number>;
  tiers: Record<string, number>;
  statuses: Record<string, number>;
  usage: UsageSnapshot;
  upstream: UpstreamSnapshot;
}

// RequestMeta is the trace of one request.
export interface RequestMeta {
  modelAlias: string;
  model: string;
  tier: string;
  protocol: string;
  request: string;
  session: string;
  keyId: string;
  channel: string;
  anonymous: boolean;
  proxy: string;
  attempts: number;
  legs: string[];
  stop: string;
  tail: string;
  stream: boolean;
  serverKeyId: string;
  shaped: boolean;
  toolAlias: string;
  usage: Usage | undefined;
  usageReported: boolean;
  attemptOutcome: string;
  outcome: string;
}

// emptyUsage builds the zero token total.
export function emptyTokenCounts(): TokenCounts {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
  };
}

// emptyUsagePeriod builds the zero usage period.
export function emptyUsagePeriod(): UsagePeriod {
  return {
    requests: 0,
    reported: 0,
    coverage: 0,
    tokens: emptyTokenCounts(),
    models: {},
    tiers: {},
    sessions: {},
    server_keys: {},
  };
}

// emptyAttemptCounts builds the zero attempt counts.
export function emptyAttemptCounts(): AttemptCounts {
  return { total: 0, success: 0, failed: 0 };
}

// emptyAttemptAggregate builds the zero attempt aggregate.
export function emptyAttemptAggregate(): AttemptAggregate {
  return {
    ...emptyAttemptCounts(),
    success_rate: 0,
    tiers: {},
    channels: {},
    keys: {},
  };
}
