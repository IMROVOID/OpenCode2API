import { dirname, resolve } from "node:path";
import type {
  Config,
  ReasoningEffort,
  RotationConfig,
  RotationGroupConfig,
} from "../types/config.js";
import { SOTA_MODELS } from "./defaults.js";
import { ConfigError } from "./strict-json.js";

const VALID_EFFORTS: ReasoningEffort[] = [
  "",
  "auto",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "none",
];

const ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isSotaModel(model: string): boolean {
  return SOTA_MODELS.includes(model as (typeof SOTA_MODELS)[number]);
}

function trimList(values: string[]): string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function applyRotationDefaults(rotation: RotationConfig): void {
  if (!rotation.sota.alias) {
    rotation.sota.alias = "sota";
  }
  if (!rotation.sweet.alias) {
    rotation.sweet.alias = "sweet";
  }
  if (rotation.sota.order.length === 0) {
    rotation.sota.order = [...SOTA_MODELS];
  }
  if (rotation.first_output_seconds === 0) {
    rotation.first_output_seconds = 30;
  }
}

function validateRotation(rotation: RotationConfig, realModels: string[]): void {
  if (rotation.first_output_seconds < 1 || rotation.first_output_seconds > 300) {
    throw new ConfigError(
      "rotation.first_output_seconds must be between 1 and 300",
    );
  }
  if (rotation.sota.alias === rotation.sweet.alias) {
    throw new ConfigError("the two rotation group aliases must differ");
  }
  const groups: [RotationGroupConfig, number][] = [
    [rotation.sota, 0],
    [rotation.sweet, 1],
  ];
  for (const [group, index] of groups) {
    if (!ALIAS_PATTERN.test(group.alias)) {
      throw new ConfigError(
        "rotation aliases must be 1-64 letters, digits, dots, dashes or underscores",
      );
    }
    if (
      realModels.includes(group.alias) ||
      isSotaModel(group.alias) ||
      rotation.sweet.order.includes(group.alias)
    ) {
      throw new ConfigError("rotation aliases must not shadow a model ID");
    }
    const seen = new Set<string>();
    for (const model of group.order) {
      if (!model || seen.has(model)) {
        throw new ConfigError("rotation order contains a duplicate or empty entry");
      }
      if (isSotaModel(model) !== (index === 0)) {
        throw new ConfigError(
          "rotation order contains a model that does not belong to its group",
        );
      }
      seen.add(model);
    }
    if (index === 0 && group.order.length !== SOTA_MODELS.length) {
      throw new ConfigError("the sota group must contain the five SOTA models");
    }
  }
}

function validateUrl(name: string, raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError(`${name} must be an http or https URL`);
  }
  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    throw new ConfigError(`${name} must be an http or https URL`);
  }
}

function validateProxyScheme(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError(`invalid proxy URL "${raw}"`);
  }
  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (!["http", "https", "socks5", "socks5h"].includes(scheme)) {
    throw new ConfigError(`unsupported proxy scheme "${scheme}"`);
  }
}

export function normalizeConfig(config: Config, configPath = ""): Config {
  const normalized = { ...config };
  normalized.reasoning = {
    effort: normalized.reasoning.effort.trim().toLowerCase() as ReasoningEffort,
    effort_by_model: { ...normalized.reasoning.effort_by_model },
  };
  normalized.rotation = {
    sota: { ...normalized.rotation.sota, order: [...normalized.rotation.sota.order] },
    sweet: { ...normalized.rotation.sweet, order: [...normalized.rotation.sweet.order] },
    first_output_seconds: normalized.rotation.first_output_seconds,
  };
  applyRotationDefaults(normalized.rotation);
  validateRotation(normalized.rotation, []);

  normalized.server_keys = trimList(normalized.server_keys);
  normalized.zen_keys = trimList(normalized.zen_keys);
  normalized.go_keys = trimList(normalized.go_keys);
  normalized.proxies = trimList(normalized.proxies);
  normalized.proxyfile = normalized.proxyfile.trim();

  if (normalized.prefer !== "zen" && normalized.prefer !== "go") {
    throw new ConfigError('prefer must be "zen" or "go"');
  }
  if (!normalized.listen.trim()) {
    throw new ConfigError("listen must not be empty");
  }
  normalized.upstream.zen = normalized.upstream.zen.trim();
  normalized.upstream.go = normalized.upstream.go.trim();
  normalized.upstream.anonymous = normalized.upstream.anonymous.trim();
  if (!normalized.upstream.anonymous) {
    normalized.upstream.anonymous = "https://opencode.ai/inference";
  }
  validateUrl("upstream.zen", normalized.upstream.zen);
  validateUrl("upstream.go", normalized.upstream.go);
  validateUrl("upstream.anonymous", normalized.upstream.anonymous);

  if (normalized.server_keys.length === 0) {
    throw new ConfigError(
      "server_keys must contain at least one local key",
    );
  }
  if (
    !normalized.anonymous &&
    normalized.zen_keys.length === 0 &&
    normalized.go_keys.length === 0
  ) {
    throw new ConfigError(
      "zen_keys or go_keys must contain at least one upstream key unless anonymous is enabled",
    );
  }
  if (normalized.retry.max_attempts < 1) {
    throw new ConfigError("retry.max_attempts must be at least 1");
  }
  if (normalized.retry.timeout_seconds < 1) {
    throw new ConfigError("retry.timeout_seconds must be at least 1");
  }
  if (normalized.models.refresh_seconds < 1) {
    throw new ConfigError("models.refresh_seconds must be at least 1");
  }
  const perf = normalized.performance;
  if (
    perf.max_idle_conns < 1 ||
    perf.max_idle_conns_per_host < 1 ||
    perf.max_conns_per_host < 0 ||
    perf.idle_conn_timeout_seconds < 1 ||
    perf.connect_timeout_seconds < 1 ||
    perf.failure_cooldown_seconds < 1
  ) {
    throw new ConfigError(
      "performance values must be positive (max_conns_per_host may be zero for unlimited)",
    );
  }
  if (perf.attempt_timeout_seconds < 0) {
    throw new ConfigError(
      "performance.attempt_timeout_seconds must not be negative (0 keeps the retry timeout)",
    );
  }
  if (
    perf.first_event_timeout_seconds < 0 ||
    perf.first_event_timeout_seconds > 86400
  ) {
    throw new ConfigError(
      "performance.first_event_timeout_seconds must be between 0 and 86400",
    );
  }
  if (!["debug", "info", "warn", "error"].includes(normalized.logging.level)) {
    throw new ConfigError("logging.level must be debug, info, warn, or error");
  }
  if (
    normalized.logging.ring_size < 100 ||
    normalized.logging.ring_size > 50000
  ) {
    throw new ConfigError("logging.ring_size must be between 100 and 50000");
  }
  if (normalized.webui.password && normalized.webui.password.length < 10) {
    throw new ConfigError("webui.password must contain at least 10 characters");
  }
  if (normalized.webui.enabled) {
    normalized.webui.listen = normalized.webui.listen.trim();
    normalized.webui.username = normalized.webui.username.trim();
    if (!normalized.webui.listen) {
      throw new ConfigError(
        "webui.listen must not be empty when webui is enabled",
      );
    }
    if (!normalized.webui.username) {
      throw new ConfigError(
        "webui.username must not be empty when webui is enabled",
      );
    }
    if (!normalized.webui.password && !normalized.webui.password_hash) {
      throw new ConfigError("webui.password is required for first-time setup");
    }
    if (
      normalized.webui.session_ttl_minutes < 5 ||
      normalized.webui.session_ttl_minutes > 10080
    ) {
      throw new ConfigError(
        "webui.session_ttl_minutes must be between 5 and 10080",
      );
    }
  }
  for (const proxy of normalized.proxies) {
    if (proxy !== "direct") {
      validateProxyScheme(proxy);
    }
  }
  for (const [model, protocol] of Object.entries(normalized.models.protocols)) {
    if (!model.trim() || !["chat", "responses", "anthropic"].includes(protocol)) {
      throw new ConfigError(
        `models.protocols contains an invalid mapping "${model}": "${protocol}"`,
      );
    }
  }
  if (!VALID_EFFORTS.includes(normalized.reasoning.effort)) {
    throw new ConfigError("reasoning.effort is not a valid effort level");
  }
  for (const [model, effort] of Object.entries(normalized.reasoning.effort_by_model)) {
    if (!model.trim()) {
      throw new ConfigError(
        "reasoning.effort_by_model must not contain an empty model ID",
      );
    }
    if (!VALID_EFFORTS.includes(effort.toLowerCase() as ReasoningEffort)) {
      throw new ConfigError(
        `reasoning.effort_by_model["${model}"] is not a valid effort level`,
      );
    }
  }

  if (normalized.proxyfile && configPath) {
    normalized.proxyfile = resolve(dirname(configPath), normalized.proxyfile);
  }
  return normalized;
}
