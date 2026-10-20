import type { Protocol, Tier } from "../types/config.js";
import { isPlainObject, sliceAt, stringAt } from "../protocol/json-util.js";
import type {
  AnonymousDecision,
  ModelMetadata,
  TierMap,
} from "./catalog-types.js";

// The endpoints the discovery reads.
export const CAPABILITIES_URL = "https://models.opencode.ai/api.json";

export const ZEN_DOCS_URL =
  "https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/web/src/content/docs/zen.mdx";

export const GO_DOCS_URL =
  "https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/web/src/content/docs/go.mdx";

// The body limits the discovery reads enforce.
const CAPABILITIES_BODY_LIMIT = 64 * 1024 * 1024;
const MODELS_BODY_LIMIT = 8 * 1024 * 1024;
const DOCS_BODY_LIMIT = 8 * 1024 * 1024;

// The row of a documentation endpoint table, "| name | `model-id` | `.../v1/<endpoint>` |".
const DOC_ENDPOINT_PATTERN =
  /\|[^|]+\|\s*`?([^|`\s]+)`?\s*\|\s*`[^`]+\/v1\/(chat\/completions|responses|messages|systemone)`/;

// Capabilities is the per-tier result of a capability fetch: the native protocol of every
// model, the models whose SDK maps to no supported protocol, and the metadata of every
// listed model.
export interface Capabilities {
  protocols: TierMap<Record<string, Protocol>>;
  unsupported: TierMap<Record<string, boolean>>;
  metadata: TierMap<Record<string, ModelMetadata>>;
}

// emptyCapabilities builds a capability set with empty maps on every tier.
export function emptyCapabilities(): Capabilities {
  return {
    protocols: { zen: {}, go: {} },
    unsupported: { zen: {}, go: {} },
    metadata: { zen: {}, go: {} },
  };
}

// capabilityTier maps a catalog provider to a tier by its ID and API URL: an
// opencode-go provider or a /go/ URL is Go, any other OpenCode provider or a
// /zen/ URL is Zen, and every other provider is skipped.
export function capabilityTier(
  providerID: string,
  api: string,
): Tier | undefined {
  const value = `${providerID} ${api}`.trim().toLowerCase();
  if (value.includes("opencode-go") || value.includes("/go/")) {
    return "go";
  }
  if (value.includes("opencode") || value.includes("/zen/")) {
    return "zen";
  }
  return undefined;
}

// protocolForSDK maps the AI SDK package a model is served through to its wire
// protocol. It reports undefined for a package the gateway cannot speak.
export function protocolForSDK(npm: string): Protocol | undefined {
  const value = npm.trim().toLowerCase();
  if (value.includes("anthropic")) {
    return "anthropic";
  }
  if (value === "@ai-sdk/openai" || value.endsWith("/openai")) {
    return "responses";
  }
  if (value.includes("openai-compatible")) {
    return "chat";
  }
  return undefined;
}

// parseCapabilities reads the capability catalog into the per-tier maps.
export function parseCapabilities(body: string): Capabilities {
  const result = emptyCapabilities();
  let providers: unknown;
  try {
    providers = JSON.parse(body) as unknown;
  } catch {
    throw new Error("OpenCode capability endpoint returned invalid JSON");
  }
  if (!isPlainObject(providers)) {
    throw new Error("OpenCode capability endpoint returned invalid JSON");
  }
  for (const [providerID, rawProvider] of Object.entries(providers)) {
    const provider = isPlainObject(rawProvider) ? rawProvider : {};
    const tier = capabilityTier(providerID, stringAt(provider, "api"));
    if (tier === undefined) {
      continue;
    }
    const models = provider["models"];
    if (!isPlainObject(models)) {
      continue;
    }
    for (const [mapKey, rawModel] of Object.entries(models)) {
      const model = isPlainObject(rawModel) ? rawModel : {};
      const modelID = stringAt(model, "id") !== "" ? stringAt(model, "id") : mapKey;
      let npm = stringAt(provider, "npm");
      const modelProvider = model["provider"];
      if (isPlainObject(modelProvider) && stringAt(modelProvider, "npm") !== "") {
        npm = stringAt(modelProvider, "npm");
      }
      const protocol = protocolForSDK(npm);
      if (protocol === undefined) {
        result.unsupported[tier][modelID] = true;
      } else {
        result.protocols[tier][modelID] = protocol;
      }
      result.metadata[tier][modelID] = parseMetadata(model);
    }
  }
  return result;
}

// parseMetadata reads the capability fields of one model.
function parseMetadata(model: Record<string, unknown>): ModelMetadata {
  const limit = model["limit"];
  const modalities = model["modalities"];
  const parsed: ModelMetadata = {
    contextWindow: 0,
    maxInput: 0,
    maxOutput: 0,
    reasoning: model["reasoning"] === true,
    toolCall: model["tool_call"] === true,
    structuredOutput: model["structured_output"] === true,
    inputModalities: [],
    outputModalities: [],
  };
  if (isPlainObject(limit)) {
    parsed.contextWindow = intOrZero(limit["context"]);
    parsed.maxInput = intOrZero(limit["input"]);
    parsed.maxOutput = intOrZero(limit["output"]);
  }
  if (isPlainObject(modalities)) {
    parsed.inputModalities = stringList(modalities["input"]);
    parsed.outputModalities = stringList(modalities["output"]);
  }
  return parsed;
}

// parseProtocolDocs parses the endpoint table of a documentation page into a
// model-to-protocol map, deriving the protocol from the endpoint path of each
// row. It fails when no row matches.
export function parseProtocolDocs(body: string): Record<string, Protocol> {
  const result: Record<string, Protocol> = {};
  for (const line of body.split("\n")) {
    const match = DOC_ENDPOINT_PATTERN.exec(line);
    if (match === null) {
      continue;
    }
    const modelID = (match[1] ?? "").trim();
    if (modelID === "" || /[ `|]/.test(modelID)) {
      continue;
    }
    const protocol = docEndpointProtocol(match[2] ?? "");
    if (protocol !== undefined) {
      result[modelID] = protocol;
    }
  }
  if (Object.keys(result).length === 0) {
    throw new Error("OpenCode endpoint documentation returned no protocol rows");
  }
  return result;
}

// docEndpointProtocol maps a documentation endpoint path onto its protocol.
function docEndpointProtocol(endpoint: string): Protocol | undefined {
  switch (endpoint) {
    case "chat/completions":
      return "chat";
    case "responses":
      return "responses";
    case "messages":
      return "anthropic";
    case "systemone":
      return "systemone";
    default:
      return undefined;
  }
}

// parseModels reads a /v1/models listing into the model ids it advertises.
// An empty list is an error.
export function parseModels(body: string): string[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    throw new Error("models endpoint returned invalid JSON");
  }
  const models: string[] = [];
  for (const raw of sliceAt(payload, "data")) {
    const id = stringAt(raw, "id");
    if (id !== "") {
      models.push(id);
    }
  }
  if (models.length === 0) {
    throw new Error("models endpoint returned an empty list");
  }
  return models;
}

// capabilitiesBodyLimit is the body limit the capability read enforces.
export { CAPABILITIES_BODY_LIMIT, MODELS_BODY_LIMIT, DOCS_BODY_LIMIT };

// isFreeModel is the name rule: a model whose ID contains "free" in any case.
export function isFreeModel(model: string): boolean {
  return model.toLowerCase().includes("free");
}

// nameDecision is the free-model decision taken from the name alone, used
// before the pricing metadata is available.
export function nameDecision(model: string): AnonymousDecision {
  return {
    allowed: isFreeModel(model),
    source: "name_fallback_metadata_pending",
  };
}

function intOrZero(value: unknown): number {
  return typeof value === "number" ? Math.trunc(value) : 0;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
