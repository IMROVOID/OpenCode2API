import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Config } from "../../types/config.js";
import { loadConfig } from "../../config/loader.js";
import { ConfigStore, resolveConfigPath } from "../../config/store.js";
import { Gateway } from "../../server/gateway.js";
import { RequestDispatcher, startServer } from "../../server/dispatcher.js";
import { registerRoutes } from "../../server/routes.js";
import { startWebUIServer } from "../../server/admin/server.js";
import { CatalogRefresher } from "../../proxy/catalog-refresh.js";

// StartOptions are the options the start command accepts.
export interface StartOptions {
  port?: number;
  host?: string;
  key?: string;
  config?: string;
  webui?: boolean;
}

// runStartCommand starts the local daemon: the API server and, when the
// WebUI is enabled, the control WebUI server.
export async function runStartCommand(options: StartOptions): Promise<void> {
  const configPath = resolveConfigPath(options.config);
  const config = await loadConfig(configPath);
  const applied = applyOverrides(config, options);
  const store = new ConfigStore(applied, configPath);
  void store;
  const gateway = new Gateway(applied);

  const dispatcher = new RequestDispatcher(() => gateway.serverKeys());
  registerRoutes(dispatcher, gateway);
  const listen = hostPort(applied.listen, options);
  const server = await startServer(dispatcher, listen);
  console.log(
    `[OpenCode2API] API server listening on ${listen} (models: ${gateway.catalog.list().length})`,
  );

  const refresher = new CatalogRefresher(gateway, applied);
  await refresher.start();

  let webuiServer: Awaited<ReturnType<typeof startWebUIServer>> | undefined;
  if (applied.webui.enabled) {
    webuiServer = await startWebUIServer(gateway, applied.webui.listen);
    console.log(`[OpenCode2API] Control WebUI listening on ${applied.webui.listen}`);
  }

  const shutdown = (): void => {
    console.log("[OpenCode2API] Shutting down...");
    refresher.stop();
    server.close();
    webuiServer?.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// applyOverrides applies the command line overrides to a configuration.
export function applyOverrides(config: Config, options: StartOptions): Config {
  const result = { ...config };
  if (options.key !== undefined && options.key !== "") {
    result.server_keys = [options.key];
  }
  if (options.host !== undefined || options.port !== undefined) {
    const host = options.host ?? hostOf(result.listen);
    const port = options.port ?? portOf(result.listen);
    result.listen = `${host}:${port}`;
  }
  if (options.webui === false) {
    result.webui = { ...result.webui, enabled: false };
  }
  return result;
}

// hostOf reads the host of a listen address.
export function hostOf(listen: string): string {
  const index = listen.lastIndexOf(":");
  return index === -1 ? "127.0.0.1" : listen.slice(0, index);
}

// portOf reads the port of a listen address.
export function portOf(listen: string): number {
  const index = listen.lastIndexOf(":");
  if (index === -1) {
    return 8080;
  }
  const port = Number(listen.slice(index + 1));
  return Number.isFinite(port) ? port : 8080;
}

// hostPort builds the listen address of the API server.
export function hostPort(listen: string, options: StartOptions): string {
  const host = options.host ?? hostOf(listen);
  const port = options.port ?? portOf(listen);
  return `${host}:${port}`;
}

// readConfigFile reads a configuration file, returning undefined when it does
// not exist.
export async function readConfigFile(path: string): Promise<Config | undefined> {
  try {
    const text = await readFile(resolve(path), "utf8");
    const { parseConfig } = await import("../../config/loader.js");
    return parseConfig(text, path);
  } catch {
    return undefined;
  }
}
