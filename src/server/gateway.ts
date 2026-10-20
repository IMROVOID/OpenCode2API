import type { ServerResponse } from "node:http";
import type { Config, Tier } from "../types/config.js";
import { KeyPool } from "../auth/key-pool.js";
import { ModelCatalog } from "../proxy/model-catalog.js";
import { AttemptRunner } from "../proxy/attempt-runner.js";
import { Logger } from "../telemetry/logger.js";
import { LogBroker } from "../telemetry/log-broker.js";
import { Metrics } from "../telemetry/metrics.js";
import { fingerprintSecret } from "../config/secrets.js";
import { handleCompletion } from "./completion-handler.js";

// Gateway serves the public API. It owns the key pools, the model catalog and
// the telemetry, and routes every client request to the upstream lane that
// can serve it.
export class Gateway {
  readonly logger: Logger;
  readonly logs: LogBroker;
  readonly metrics = new Metrics();
  readonly catalog: ModelCatalog;
  runner: AttemptRunner;

  private zenPool: KeyPool;
  private goPool: KeyPool;
  private config: Config;
  constructor(config: Config) {
    this.config = config;
    this.logs = new LogBroker(config.logging.ring_size);
    this.logger = new Logger(this.logs);
    this.catalog = new ModelCatalog({
      prefer: config.prefer,
      protocols: config.models.protocols,
      freeOnly: config.models.free_only,
    });
    this.zenPool = new KeyPool(config.zen_keys);
    this.goPool = new KeyPool(config.go_keys);
    this.runner = this.buildRunner();
    this.logger.setLevel(config.logging.level);
    this.logger.replaceSecrets(this.secrets());
  }

  // apply swaps the running configuration.
  apply(config: Config): void {
    this.config = config;
    this.zenPool = new KeyPool(config.zen_keys);
    this.goPool = new KeyPool(config.go_keys);
    this.runner = this.buildRunner();
    this.catalog.setOptions({
      prefer: config.prefer,
      protocols: config.models.protocols,
      freeOnly: config.models.free_only,
    });
    this.logger.setLevel(config.logging.level);
    this.logger.replaceSecrets(this.secrets());
    this.logs.resize(config.logging.ring_size);
  }

  // current returns the running configuration.
  current(): Config {
    return this.config;
  }

  // buildRunner creates the attempt runner of the running configuration.
  private buildRunner(): AttemptRunner {
    return new AttemptRunner(
      { zen: this.zenPool, go: this.goPool },
      this.config.upstream,
      this.config.retry.max_attempts,
      this.config.retry.timeout_seconds,
      this.logger,
      this.metrics,
    );
  }

  // secrets lists the values the logger masks out of its output.
  private secrets(): string[] {
    const config = this.config;
    const values = [
      ...config.server_keys,
      ...config.zen_keys,
      ...config.go_keys,
      ...config.proxies,
    ];
    if (config.webui.password !== undefined) {
      values.push(config.webui.password);
    }
    return values;
  }

  // serverKeys returns the local server keys the client authenticates with.
  serverKeys(): string[] {
    return this.config.server_keys;
  }

  // hasZenKeys reports whether the Zen tier has a key.
  hasZenKeys(): boolean {
    return !this.zenPool.isEmpty();
  }

  // hasGoKeys reports whether the Go tier has a key.
  hasGoKeys(): boolean {
    return !this.goPool.isEmpty();
  }

  // tierBase returns the base URL of a tier.
  tierBase(tier: Tier): string {
    return tier === "go" ? this.config.upstream.go : this.config.upstream.zen;
  }

  // handleCompletion serves one completion request.
  async handleCompletion(
    protocol: Parameters<typeof handleCompletion>[1],
    body: Buffer,
    headers: NodeJS.Dict<string | string[]>,
    response: ServerResponse,
    scope: string,
  ): Promise<void> {
    await handleCompletion(this, protocol, body, headers, response, scope);
  }

  // debugRequest runs one request in-process for the Playground. The response
  // is captured rather than forwarded to a client.
  async debugRequest(
    protocol: Parameters<typeof handleCompletion>[1],
    payload: Record<string, unknown>,
    serverKey: string,
  ): Promise<{ status: number; body: unknown; requestId: string }> {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const headers: NodeJS.Dict<string | string[]> = {
      authorization: `Bearer ${serverKey}`,
      "content-type": "application/json",
    };
    const chunks: Buffer[] = [];
    let status = 0;
    const response = {
      writeHead(code: number): typeof response {
        status = code;
        return response;
      },
      setHeader(): void {},
      end(chunk?: Buffer | string): void {
        if (chunk !== undefined) {
          chunks.push(
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8"),
          );
        }
      },
      headersSent: false,
    } as unknown as ServerResponse;
    await this.handleCompletion(
      protocol,
      body,
      headers,
      response,
      serverKeyScope(serverKey),
    );
    const text = Buffer.concat(chunks).toString("utf8");
    let parsed: unknown = text;
    try {
      parsed = text === "" ? null : (JSON.parse(text) as unknown);
    } catch {
      parsed = text;
    }
    return { status, body: parsed, requestId: "" };
  }
}

// serverKeyScope returns the scope a server key scopes its sessions with.
export function serverKeyScope(key: string): string {
  return key === "" ? "" : fingerprintSecret(key);
}
