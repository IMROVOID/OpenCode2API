export type Tier = "zen" | "go";

export type Protocol = "chat" | "responses" | "anthropic" | "systemone";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type ReasoningEffort =
  | ""
  | "auto"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "none";

export interface UpstreamConfig {
  zen: string;
  go: string;
  anonymous: string;
}

export interface RetryConfig {
  max_attempts: number;
  timeout_seconds: number;
}

export interface ModelsConfig {
  refresh_seconds: number;
  protocols: Record<string, string>;
  free_only: boolean;
}

export interface PerformanceConfig {
  max_idle_conns: number;
  max_idle_conns_per_host: number;
  max_conns_per_host: number;
  idle_conn_timeout_seconds: number;
  connect_timeout_seconds: number;
  failure_cooldown_seconds: number;
  attempt_timeout_seconds: number;
  first_event_timeout_seconds: number;
}

export interface LoggingConfig {
  level: LogLevel;
  ring_size: number;
  dump_request_bodies: boolean;
}

export interface WebUIConfig {
  enabled: boolean;
  listen: string;
  username: string;
  password?: string;
  password_hash?: string;
  session_ttl_minutes: number;
}

export interface RotationGroupConfig {
  alias: string;
  order: string[];
}

export interface RotationConfig {
  sota: RotationGroupConfig;
  sweet: RotationGroupConfig;
  first_output_seconds: number;
}

export interface ReasoningConfig {
  effort: ReasoningEffort;
  effort_by_model: Record<string, ReasoningEffort>;
}

export interface ServerKeyMetadata {
  name: string;
  disabled?: boolean;
  created_at?: string;
}

export interface Config {
  listen: string;
  server_keys: string[];
  server_key_metadata: Record<string, ServerKeyMetadata>;
  zen_keys: string[];
  go_keys: string[];
  anonymous: boolean;
  proxies: string[];
  proxyfile: string;
  upstream: UpstreamConfig;
  retry: RetryConfig;
  models: ModelsConfig;
  performance: PerformanceConfig;
  logging: LoggingConfig;
  webui: WebUIConfig;
  prefer: Tier;
  reasoning: ReasoningConfig;
  rotation: RotationConfig;
}
