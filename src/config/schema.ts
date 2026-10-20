import type { FieldType } from "./strict-json.js";

export const CONFIG_SCHEMA: FieldType = {
  kind: "object",
  fields: {
    listen: { kind: "string" },
    server_keys: { kind: "string[]" },
    server_key_metadata: {
      kind: "record",
      values: {
        kind: "object",
        fields: {
          name: { kind: "string" },
          disabled: { kind: "boolean" },
          created_at: { kind: "string" },
        },
        optional: ["disabled", "created_at"],
      },
    },
    zen_keys: { kind: "string[]" },
    go_keys: { kind: "string[]" },
    anonymous: { kind: "boolean" },
    proxies: { kind: "string[]" },
    proxyfile: { kind: "string" },
    upstream: {
      kind: "object",
      fields: {
        zen: { kind: "string" },
        go: { kind: "string" },
        anonymous: { kind: "string" },
      },
    },
    retry: {
      kind: "object",
      fields: {
        max_attempts: { kind: "number", integer: true },
        timeout_seconds: { kind: "number", integer: true },
      },
    },
    models: {
      kind: "object",
      fields: {
        refresh_seconds: { kind: "number", integer: true },
        protocols: { kind: "record", values: { kind: "string" } },
        free_only: { kind: "boolean" },
      },
    },
    performance: {
      kind: "object",
      fields: {
        max_idle_conns: { kind: "number", integer: true },
        max_idle_conns_per_host: { kind: "number", integer: true },
        max_conns_per_host: { kind: "number", integer: true },
        idle_conn_timeout_seconds: { kind: "number", integer: true },
        connect_timeout_seconds: { kind: "number", integer: true },
        failure_cooldown_seconds: { kind: "number", integer: true },
        attempt_timeout_seconds: { kind: "number", integer: true },
        first_event_timeout_seconds: { kind: "number", integer: true },
      },
    },
    logging: {
      kind: "object",
      fields: {
        level: { kind: "string", values: ["debug", "info", "warn", "error"] },
        ring_size: { kind: "number", integer: true },
        dump_request_bodies: { kind: "boolean" },
      },
    },
    webui: {
      kind: "object",
      fields: {
        enabled: { kind: "boolean" },
        listen: { kind: "string" },
        username: { kind: "string" },
        password: { kind: "string" },
        password_hash: { kind: "string" },
        session_ttl_minutes: { kind: "number", integer: true },
      },
      optional: ["password", "password_hash"],
    },
    prefer: { kind: "string", values: ["zen", "go"] },
    reasoning: {
      kind: "object",
      fields: {
        effort: {
          kind: "string",
          values: [
            "",
            "auto",
            "minimal",
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
            "none",
          ],
        },
        effort_by_model: { kind: "record", values: { kind: "string" } },
      },
    },
    rotation: {
      kind: "object",
      fields: {
        sota: rotationGroup(),
        sweet: rotationGroup(),
        first_output_seconds: { kind: "number", integer: true },
      },
    },
  },
};

// rotationGroup is the schema of one rotation group.
function rotationGroup(): FieldType {
  return {
    kind: "object",
    fields: {
      alias: { kind: "string" },
      order: { kind: "string[]" },
    },
  };
}
