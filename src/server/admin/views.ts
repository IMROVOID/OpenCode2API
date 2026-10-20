import type { Config } from "../../types/config.js";
import { fingerprintSecret, maskSecret } from "../../config/secrets.js";
import type { WebUIServer } from "./server.js";

// A secret as the WebUI shows it.
export interface SecretView {
  id: string;
  display: string;
}

// secretView renders a masked secret.
export function secretView(value: string): SecretView {
  return { id: fingerprintSecret(value), display: maskSecret(value) };
}

// configView renders a configuration for the WebUI. The secrets are masked
// and the WebUI password is never exposed.
export function configView(config: Config): Record<string, unknown> {
  return {
    listen: config.listen,
    server_keys: config.server_keys.map(secretView),
    zen_keys: config.zen_keys.map(secretView),
    go_keys: config.go_keys.map(secretView),
    anonymous: config.anonymous,
    proxies: config.proxies.map(secretView),
    proxyfile: config.proxyfile,
    upstream: config.upstream,
    retry: config.retry,
    models: config.models,
    performance: config.performance,
    logging: config.logging,
    prefer: config.prefer,
    reasoning: config.reasoning,
    webui: {
      enabled: config.webui.enabled,
      listen: config.webui.listen,
      username: config.webui.username,
      session_ttl_minutes: config.webui.session_ttl_minutes,
    },
    effective: {
      listen: config.listen,
      webui_listen: config.webui.listen,
      webui_enabled: config.webui.enabled,
    },
  };
}

// apiKeyViews renders the local server keys.
export function apiKeyViews(config: Config): Record<string, unknown>[] {
  return config.server_keys.map((key, index) => {
    const id = fingerprintSecret(key);
    const meta = config.server_key_metadata[id];
    return {
      id,
      name: meta?.name ?? `Key ${index + 1}`,
      display: maskSecret(key),
      enabled: meta?.disabled !== true,
      created_at: meta?.created_at,
      usage: { lifetime: { requests: 0 }, last_hour: { requests: 0 } },
    };
  });
}

// monitorPayload renders the monitor document.
export function monitorPayload(server: WebUIServer): Record<string, unknown> {
  const metrics = server.gateway.metrics.snapshot();
  return {
    version: "dev",
    metrics,
    usage: metrics.usage,
    upstream: metrics.upstream,
    resources: {
      models: server.gateway.catalog.snapshot(),
      keys: [],
      proxies: [],
      anonymous: server.currentConfig().anonymous,
      metadata: { ready: false, models: 0, stale: false },
    },
  };
}

// debugModelsPayload renders the model diagnostics.
export function debugModelsPayload(server: WebUIServer): Record<string, unknown> {
  const config = server.currentConfig();
  const models = server.gateway.catalog.list().map((model) =>
    server.gateway.catalog.diagnostic(
      model,
      "chat",
      server.gateway.hasZenKeys(),
      server.gateway.hasGoKeys(),
      config.anonymous,
    ),
  );
  return {
    models,
    keys: {
      zen: config.zen_keys.map((key, index) => ({
        id: fingerprintSecret(key),
        tier: "zen",
        display: maskSecret(key),
        index,
        failures: 0,
      })),
      go: config.go_keys.map((key, index) => ({
        id: fingerprintSecret(key),
        tier: "go",
        display: maskSecret(key),
        index,
        failures: 0,
      })),
    },
    metadata: { ready: false, models: 0, stale: false },
    catalog: server.gateway.catalog.snapshot(),
    last_inference: null,
  };
}

// rotationPayload renders the rotation state.
export function rotationPayload(server: WebUIServer): Record<string, unknown> {
  const rotation = server.currentConfig().rotation;
  return {
    groups: [
      {
        id: "sota",
        alias: rotation.sota.alias,
        order: rotation.sota.order,
        current: rotation.sota.order[0] ?? "",
        generation: 0,
        paused: {},
        available: {},
        switches: [],
      },
      {
        id: "sweet",
        alias: rotation.sweet.alias,
        order: rotation.sweet.order,
        current: rotation.sweet.order[0] ?? "",
        generation: 0,
        paused: {},
        available: {},
        switches: [],
      },
    ],
    attempts: [],
    first_output_seconds: rotation.first_output_seconds,
  };
}

// quotaPayload renders the Go quota state.
export function quotaPayload(server: WebUIServer): Record<string, unknown> {
  const config = server.currentConfig();
  return {
    models: [],
    accounts: config.go_keys.map((key) => ({
      id: fingerprintSecret(key),
      display: maskSecret(key),
      status: "unavailable",
    })),
    scope: "shared_subscription",
    source: `${config.upstream.go}/v1/usage`,
    cache_seconds: 60,
    catalog: server.gateway.catalog.snapshot(),
    note:
      "OpenCode returns a shared subscription quota; multiple Go keys may belong to the same plan and cannot be added up.",
  };
}
