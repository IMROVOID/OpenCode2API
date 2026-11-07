import type { Protocol } from "../types/config.js";
import { isPlainObject, sliceAt, stringAt } from "./json-util.js";

export const V1_READ_TOOL = "read";

export const V2_CORE_TOOLS = ["shell", "edit", "glob", "grep", "read"] as const;

const V1_DEPRECATED_READ_DESCRIPTION =
  "Deprecated. This tool is provided for compatibility only. Do not call it.";

interface ToolDefinition {
  description: string;
  parameters: Record<string, unknown>;
}

const KNOWN_TOOLS: Map<string, ToolDefinition> = loadKnownTools();

function loadKnownTools(): Map<string, ToolDefinition> {
  const map = new Map<string, ToolDefinition>();
  try {
    const raw = opencodeToolsJSON as unknown;
    if (isPlainObject(raw)) {
      for (const [name, value] of Object.entries(raw)) {
        if (!isPlainObject(value)) {
          continue;
        }
        const description =
          typeof value.description === "string" ? value.description : "";
        const parameters = isPlainObject(value.parameters)
          ? value.parameters
          : { type: "object", properties: {} };
        map.set(name, { description, parameters });
      }
    }
  } catch {
    // A missing tool table only degrades the free-tier tool gate.
  }
  return map;
}

import opencodeToolsJSON from "./tools/opencode_tools.json" with { type: "json" };

export function knownOpencodeTool(name: string): ToolDefinition | undefined {
  return KNOWN_TOOLS.get(name);
}

export function toolName(protocol: Protocol, item: unknown): string {
  if (protocol === "chat") {
    return stringAt(item, "function", "name");
  }
  return stringAt(item, "name");
}

function setToolName(protocol: Protocol, item: unknown, name: string): void {
  if (!isPlainObject(item)) {
    return;
  }
  if (protocol === "chat") {
    const fn = item.function;
    if (isPlainObject(fn)) {
      fn.name = name;
    }
    return;
  }
  item.name = name;
}

export function v2Tool(protocol: Protocol, name: string): Record<string, unknown> {
  const definition = knownOpencodeTool(name);
  const description = definition?.description ?? `Agent tool ${name}`;
  const parameters = definition?.parameters ?? {
    type: "object",
    properties: {},
  };
  if (protocol === "chat") {
    return {
      type: "function",
      function: { name, description, parameters, strict: false },
    };
  }
  if (protocol === "anthropic") {
    return { name, description, input_schema: parameters };
  }
  return { type: "function", name, description, parameters };
}

export function v2Toolset(
  protocol: Protocol,
  names: readonly string[] = V2_CORE_TOOLS,
): Record<string, unknown>[] {
  return names.map((name) => v2Tool(protocol, name));
}

export function isV1ReadToolCandidate(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (lower === "") {
    return false;
  }
  if (lower === V1_READ_TOOL) {
    return true;
  }
  const normalized = lower.replace(/[_\-.]/g, "");
  if (
    [
      "readfile",
      "fileread",
      "readfiles",
      "readtext",
      "readtextfile",
      "readcontent",
      "viewfile",
    ].includes(normalized)
  ) {
    return true;
  }
  return (
    lower.startsWith("read_") ||
    lower.startsWith("read-") ||
    lower.endsWith("_read") ||
    lower.endsWith("-read")
  );
}

function v1DeprecatedReadTool(protocol: Protocol): Record<string, unknown> {
  const parameters = { type: "object", properties: {} };
  if (protocol === "chat") {
    return {
      type: "function",
      function: {
        name: V1_READ_TOOL,
        description: V1_DEPRECATED_READ_DESCRIPTION,
        parameters,
      },
    };
  }
  if (protocol === "anthropic") {
    return {
      name: V1_READ_TOOL,
      description: V1_DEPRECATED_READ_DESCRIPTION,
      input_schema: parameters,
    };
  }
  return {
    type: "function",
    name: V1_READ_TOOL,
    description: V1_DEPRECATED_READ_DESCRIPTION,
    parameters,
  };
}

export function rewriteV1ToolReferences(
  payload: Record<string, unknown>,
  protocol: Protocol,
  fromName: string,
  toName: string,
): void {
  if (fromName === "" || fromName === toName) {
    return;
  }
  if (protocol === "chat") {
    const choice = payload.tool_choice;
    if (isPlainObject(choice) && isPlainObject(choice.function)) {
      if (choice.function.name === fromName) {
        choice.function.name = toName;
      }
    }
    for (const raw of sliceAt(payload, "messages")) {
      for (const rawCall of sliceAt(raw, "tool_calls")) {
        if (isPlainObject(rawCall) && isPlainObject(rawCall.function)) {
          if (rawCall.function.name === fromName) {
            rawCall.function.name = toName;
          }
        }
      }
    }
    return;
  }
  if (protocol === "responses") {
    const choice = payload.tool_choice;
    if (isPlainObject(choice) && choice.name === fromName) {
      choice.name = toName;
    }
    for (const item of sliceAt(payload, "input")) {
      if (
        isPlainObject(item) &&
        item.type === "function_call" &&
        item.name === fromName
      ) {
        item.name = toName;
      }
    }
    return;
  }
  const choice = payload.tool_choice;
  if (isPlainObject(choice) && choice.name === fromName) {
    choice.name = toName;
  }
  for (const msg of sliceAt(payload, "messages")) {
    for (const block of sliceAt(msg, "content")) {
      if (
        isPlainObject(block) &&
        block.type === "tool_use" &&
        block.name === fromName
      ) {
        block.name = toName;
      }
    }
  }
}

export interface V1ReadToolResult {
  alias: string;
  changed: boolean;
}

export function ensureV1ReadTool(
  payload: Record<string, unknown>,
  protocol: Protocol,
): V1ReadToolResult {
  const raw = payload.tools;
  if (raw === undefined) {
    payload.tools = [v1DeprecatedReadTool(protocol)];
    return { alias: "", changed: true };
  }
  if (!Array.isArray(raw)) {
    return { alias: "", changed: false };
  }
  const items = raw as unknown[];
  let candidateIndex = -1;
  let candidateName = "";
  let caseFoldCandidate = false;
  for (const [index, item] of items.entries()) {
    const name = toolName(protocol, item);
    if (name === "") {
      continue;
    }
    if (name === V1_READ_TOOL) {
      return { alias: "", changed: false };
    }
    if (name.toLowerCase() === V1_READ_TOOL) {
      if (!caseFoldCandidate) {
        candidateIndex = index;
        candidateName = name;
        caseFoldCandidate = true;
      }
      continue;
    }
    if (candidateIndex < 0 && isV1ReadToolCandidate(name)) {
      candidateIndex = index;
      candidateName = name;
    }
  }
  if (candidateIndex >= 0) {
    setToolName(protocol, items[candidateIndex], V1_READ_TOOL);
    rewriteV1ToolReferences(payload, protocol, candidateName, V1_READ_TOOL);
    payload.tools = items;
    return { alias: candidateName, changed: true };
  }
  items.push(v1DeprecatedReadTool(protocol));
  payload.tools = items;
  return { alias: "", changed: true };
}

export function ensureV2Tools(
  payload: Record<string, unknown>,
  protocol: Protocol,
): boolean {
  let changed = false;
  if (protocol === "chat") {
    if (payload.tool_choice === "none") {
      delete payload.tool_choice;
      changed = true;
    }
    if (payload.max_tokens !== undefined) {
      if (payload.max_completion_tokens === undefined) {
        payload.max_completion_tokens = payload.max_tokens;
      }
      delete payload.max_tokens;
      changed = true;
    } else if (payload.max_completion_tokens === undefined) {
      payload.max_completion_tokens = 32000;
      changed = true;
    }
  }
  const raw = payload.tools;
  if (raw === undefined) {
    payload.tools = v2Toolset(protocol);
    return true;
  }
  if (!Array.isArray(raw)) {
    return changed;
  }
  const items = raw as unknown[];
  const present = new Set<string>();
  for (const [index, item] of items.entries()) {
    const name = toolName(protocol, item);
    if (name === "") {
      continue;
    }
    present.add(name);
    if (knownOpencodeTool(name)) {
      items[index] = v2Tool(protocol, name);
      changed = true;
    }
  }
  const missing = V2_CORE_TOOLS.filter((name) => !present.has(name));
  if (missing.length > 0) {
    items.push(...v2Toolset(protocol, missing));
    changed = true;
  }
  if (!changed) {
    return false;
  }
  payload.tools = items;
  return true;
}

export function ensureAnonymousChatUsage(
  payload: Record<string, unknown>,
  protocol: Protocol,
): boolean {
  if (protocol !== "chat") {
    return false;
  }
  const options = payload.stream_options;
  if (!isPlainObject(options)) {
    payload.stream_options = { include_usage: true };
    return true;
  }
  if (options.include_usage === true) {
    return false;
  }
  options.include_usage = true;
  return true;
}

export interface PreparedBody {
  body: string;
  alias: string;
  shaped: boolean;
}

export function prepareAnonymousBody(
  rawBody: string,
  protocol: Protocol,
  v1: boolean,
): PreparedBody {
  if (protocol === "systemone") {
    return { body: rawBody, alias: "", shaped: false };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { body: rawBody, alias: "", shaped: false };
  }
  if (!isPlainObject(payload)) {
    return { body: rawBody, alias: "", shaped: false };
  }
  let changed = false;
  if (payload.stream !== true) {
    payload.stream = true;
    changed = true;
  }
  if (ensureAnonymousChatUsage(payload, protocol)) {
    changed = true;
  }
  let alias = "";
  if (v1) {
    const result = ensureV1ReadTool(payload, protocol);
    alias = result.alias;
    if (result.changed) {
      changed = true;
    }
  } else if (ensureV2Tools(payload, protocol)) {
    changed = true;
  }
  if (!changed) {
    return { body: rawBody, alias, shaped: false };
  }
  return { body: JSON.stringify(payload), alias, shaped: true };
}
