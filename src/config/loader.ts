import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Config } from "../types/config.js";
import { cloneConfig, DEFAULT_CONFIG } from "./defaults.js";
import { normalizeConfig } from "./normalize.js";
import { CONFIG_SCHEMA } from "./schema.js";
import { ConfigError, decodeStrict } from "./strict-json.js";

export function stripJsonComments(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((line) => !/^\s*\/\//.test(line));
  return kept.join("\n");
}

export function parseConfig(text: string, source: string): Config {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(text));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`parse ${source}: ${detail}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`parse ${source}: config must be a JSON object`);
  }
  const decoded = decodeStrict(parsed, CONFIG_SCHEMA, "config");
  return { ...cloneConfig(DEFAULT_CONFIG), ...decoded } as unknown as Config;
}

export function resolveConfigPath(explicit?: string): string {
  if (explicit) {
    return resolve(explicit);
  }
  const fromEnv = process.env.OPENCODE2API_CONFIG;
  if (fromEnv) {
    return resolve(fromEnv);
  }
  return resolve(process.cwd(), "config.json");
}

export async function loadConfig(path: string): Promise<Config> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`read ${path}: ${detail}`);
  }
  const config = parseConfig(text, path);
  return normalizeConfig(config, path);
}
