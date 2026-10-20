import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Config } from "../types/config.js";
import { cloneConfig } from "./defaults.js";
import { normalizeConfig } from "./normalize.js";
import { fingerprintSecret } from "./secrets.js";

export function resolveConfigPath(explicit?: string): string {
  if (explicit) {
    return resolve(explicit);
  }
  const fromEnv = process.env.OPENCODE2API_CONFIG;
  if (fromEnv) {
    return resolve(fromEnv);
  }
  const besideBinary = resolve(dirname(process.execPath), "config.json");
  return besideBinary;
}

export function configSidecarPath(configPath: string, suffix: string): string {
  return `${configPath}${suffix}`;
}

export class ConfigStore {
  private config: Config;
  private readonly path: string;

  constructor(config: Config, path: string) {
    this.config = config;
    this.path = path;
  }

  get current(): Config {
    return this.config;
  }

  get filePath(): string {
    return this.path;
  }

  replace(config: Config): Config {
    this.config = normalizeConfig(config, this.path);
    return this.config;
  }

  async save(): Promise<void> {
    const payload = cloneConfig(this.config);
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    const tempPath = `${this.path}.tmp`;
    const backupPath = `${this.path}.bak`;
    await mkdir(dirname(this.path), { recursive: true });
    try {
      await copyFile(this.path, backupPath);
    } catch {
      // No previous config to back up on the first save.
    }
    await writeFile(tempPath, serialized, "utf8");
    await rename(tempPath, this.path);
  }

  serverKeyMetadata(): Record<string, { name: string; disabled: boolean }> {
    const result: Record<string, { name: string; disabled: boolean }> = {};
    for (const [id, meta] of Object.entries(this.config.server_key_metadata)) {
      result[id] = { name: meta.name, disabled: meta.disabled ?? false };
    }
    return result;
  }

  isServerKeyEnabled(key: string): boolean {
    const meta = this.config.server_key_metadata[fingerprintSecret(key)];
    return meta?.disabled !== true;
  }

  firstEnabledServerKey(): string {
    for (const key of this.config.server_keys) {
      if (this.isServerKeyEnabled(key)) {
        return key;
      }
    }
    return "";
  }
}
