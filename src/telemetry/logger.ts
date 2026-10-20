import type { LogLevel } from "../types/config.js";
import { SecretRedactor } from "../config/secrets.js";
import { LogBroker, type LogEvent } from "./log-broker.js";

// The attribute keys whose value is masked in a log event.
const SENSITIVE_KEYS = ["password", "authorization", "cookie", "secret"];

// The level order the logger filters on.
const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Logger writes structured JSON lines to stdout and publishes the redacted
// events to the broker the WebUI reads.
export class Logger {
  private level: LogLevel = "info";
  private readonly redactor = new SecretRedactor();

  constructor(private readonly broker: LogBroker) {}

  // setLevel changes the minimum level the logger emits.
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  // currentLevel reports the minimum level the logger emits.
  currentLevel(): LogLevel {
    return this.level;
  }

  // replaceSecrets sets the secrets the logger masks out of its output.
  replaceSecrets(secrets: string[]): void {
    this.redactor.replace(secrets);
  }

  // redact masks the configured secrets out of a text.
  redact(text: string): string {
    return this.redactor.redact(text);
  }

  debug(message: string, component: string, fields?: Record<string, unknown>): void {
    this.write("debug", message, component, fields);
  }

  info(message: string, component: string, fields?: Record<string, unknown>): void {
    this.write("info", message, component, fields);
  }

  warn(message: string, component: string, fields?: Record<string, unknown>): void {
    this.write("warn", message, component, fields);
  }

  error(message: string, component: string, fields?: Record<string, unknown>): void {
    this.write("error", message, component, fields);
  }

  private write(
    level: LogLevel,
    message: string,
    component: string,
    fields?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }
    const redactedMessage = this.redact(message);
    const safeFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields ?? {})) {
      if (key === "component") {
        continue;
      }
      safeFields[key] = this.sanitizeValue(key, value);
    }
    const event: LogEvent = {
      sequence: 0,
      time: new Date().toISOString(),
      level,
      message: redactedMessage,
      component,
      fields: safeFields,
    };
    const line = JSON.stringify({
      time: event.time,
      level: level.toUpperCase(),
      msg: redactedMessage,
      component,
      ...safeFields,
    });
    process.stdout.write(`${line}\n`);
    this.broker.publish(event);
  }

  // sanitizeValue masks the sensitive keys and redacts every string value.
  private sanitizeValue(key: string, value: unknown): unknown {
    if (isSensitiveKey(key)) {
      return "***";
    }
    if (typeof value === "string") {
      return this.redact(value);
    }
    if (value instanceof Error) {
      return this.redact(value.message);
    }
    return value;
  }
}

// isSensitiveKey reports whether a log attribute's key names a secret.
export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((hint) => lower.includes(hint));
}
