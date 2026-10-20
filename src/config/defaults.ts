import type { Config } from "../types/config.js";

export const SOTA_MODELS = [
  "deepseek-v4.1-flash",
  "glm-5.3",
  "grok-4.6",
  "kimi-k3",
  "qwen3.8-max",
] as const;

export const ANONYMOUS_KEY = "public";

export const V1_BASE = "https://opencode.ai/zen";

export const DEFAULT_CONFIG: Config = {
  listen: "127.0.0.1:8080",
  server_keys: [],
  server_key_metadata: {},
  zen_keys: [],
  go_keys: [],
  anonymous: false,
  proxies: [],
  proxyfile: "",
  upstream: {
    zen: V1_BASE,
    go: "https://opencode.ai/zen/go",
    anonymous: "https://opencode.ai/inference",
  },
  retry: {
    max_attempts: 3,
    timeout_seconds: 300,
  },
  models: {
    refresh_seconds: 300,
    protocols: {},
    free_only: false,
  },
  performance: {
    max_idle_conns: 2048,
    max_idle_conns_per_host: 256,
    max_conns_per_host: 0,
    idle_conn_timeout_seconds: 120,
    connect_timeout_seconds: 5,
    failure_cooldown_seconds: 15,
    attempt_timeout_seconds: 0,
    first_event_timeout_seconds: 0,
  },
  logging: {
    level: "info",
    ring_size: 2000,
    dump_request_bodies: false,
  },
  webui: {
    enabled: true,
    listen: "0.0.0.0:8081",
    username: "admin",
    session_ttl_minutes: 720,
  },
  prefer: "go",
  reasoning: {
    effort: "",
    effort_by_model: {},
  },
  rotation: {
    sota: { alias: "sota", order: [...SOTA_MODELS] },
    sweet: { alias: "sweet", order: [] },
    first_output_seconds: 30,
  },
};

export function cloneConfig(config: Config): Config {
  return {
    ...config,
    server_keys: [...config.server_keys],
    server_key_metadata: { ...config.server_key_metadata },
    zen_keys: [...config.zen_keys],
    go_keys: [...config.go_keys],
    proxies: [...config.proxies],
    upstream: { ...config.upstream },
    retry: { ...config.retry },
    models: {
      ...config.models,
      protocols: { ...config.models.protocols },
    },
    performance: { ...config.performance },
    logging: { ...config.logging },
    webui: { ...config.webui },
    reasoning: {
      effort: config.reasoning.effort,
      effort_by_model: { ...config.reasoning.effort_by_model },
    },
    rotation: {
      sota: { ...config.rotation.sota, order: [...config.rotation.sota.order] },
      sweet: { ...config.rotation.sweet, order: [...config.rotation.sweet.order] },
      first_output_seconds: config.rotation.first_output_seconds,
    },
  };
}
