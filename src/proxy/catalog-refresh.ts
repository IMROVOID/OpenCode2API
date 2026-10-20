import type { Config } from "../types/config.js";
import { isV1Upstream } from "../protocol/lanes.js";
import { V2_USER_AGENT } from "../protocol/lanes.js";
import { ANONYMOUS_KEY } from "../config/defaults.js";
import {
  CAPABILITIES_URL,
  GO_DOCS_URL,
  ZEN_DOCS_URL,
  parseCapabilities,
  parseModels,
  parseProtocolDocs,
} from "./model-discovery.js";
import type { Gateway } from "../server/gateway.js";

// The timeout the catalog refresh allows.
const REFRESH_TIMEOUT_MS = 30_000;

// CatalogRefresher keeps the model catalog in step with the upstream. It
// refreshes the two model listings and the capability catalog on a timer.
export class CatalogRefresher {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly gateway: Gateway,
    private readonly config: Config,
  ) {}

  // start performs the first refresh and schedules the following ones.
  async start(): Promise<void> {
    await this.refresh();
    const seconds = Math.max(1, this.config.models.refresh_seconds);
    this.timer = setInterval(() => {
      void this.refresh();
    }, seconds * 1000);
    this.timer.unref?.();
  }

  // stop ends the refresh timer.
  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  // refresh reads the model listings and the capability catalog. The catalog
  // is replaced only when at least one listing succeeded.
  async refresh(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const [zen, go] = await Promise.all([
        this.fetchTierModels(this.config.upstream.zen, this.config.zen_keys[0] ?? ANONYMOUS_KEY),
        this.fetchTierModels(this.config.upstream.go, this.config.go_keys[0] ?? ANONYMOUS_KEY),
      ]);
      if (zen.length > 0) {
        this.gateway.catalog.applyTier("zen", zen);
      }
      if (go.length > 0) {
        this.gateway.catalog.applyTier("go", go);
      }
      if (zen.length > 0 || go.length > 0) {
        this.gateway.catalog.markLive(this.config.models.refresh_seconds);
      }
      await this.refreshCapabilities();
    } catch (error) {
      this.gateway.logger.warn("catalog refresh failed", "models", {
        event: "catalog_refresh_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.running = false;
    }
  }

  // refreshCapabilities reads the upstream capability catalog. A failure is
  // logged only, because the model listings already carry the routes.
  private async refreshCapabilities(): Promise<void> {
    try {
      const response = await fetch(CAPABILITIES_URL, {
        headers: {
          Accept: "application/json",
          "User-Agent": V2_USER_AGENT,
        },
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `OpenCode capability endpoint returned HTTP ${response.status}`,
        );
      }
      const capabilities = parseCapabilities(await response.text());
      await this.applyDocs(capabilities, "zen", ZEN_DOCS_URL);
      await this.applyDocs(capabilities, "go", GO_DOCS_URL);
      this.gateway.catalog.applyCapabilities(capabilities);
      this.gateway.logger.info("model catalog refreshed", "models", {
        event: "catalog_refreshed",
      });
    } catch (error) {
      this.gateway.logger.warn("capability refresh failed", "models", {
        event: "capability_refresh_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // applyDocs refines the capability data with the endpoint table of a
  // documentation page. A page that cannot be fetched is skipped.
  private async applyDocs(
    capabilities: { protocols: { zen: Record<string, string>; go: Record<string, string> } },
    tier: "zen" | "go",
    url: string,
  ): Promise<void> {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/plain, text/markdown, */*",
          "User-Agent": V2_USER_AGENT,
        },
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
      if (response.status < 200 || response.status >= 300) {
        return;
      }
      const protocols = parseProtocolDocs(await response.text());
      for (const [model, protocol] of Object.entries(protocols)) {
        capabilities.protocols[tier][model] = protocol;
      }
    } catch {
      // A documentation page that cannot be fetched only costs the refinement.
    }
  }

  // fetchTierModels lists the models a tier advertises.
  private async fetchTierModels(
    baseURL: string,
    key: string,
  ): Promise<string[]> {
    const url = `${baseURL.replace(/\/+$/, "")}/v1/models`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        "User-Agent": isV1Upstream(baseURL)
          ? "opencode/1.19.3"
          : V2_USER_AGENT,
        "x-opencode-client": "cli",
      },
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`models endpoint returned HTTP ${response.status}`);
    }
    return parseModels(await response.text());
  }
}
