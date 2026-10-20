import type { Protocol, Tier } from "../types/config.js";
import type { Route } from "../types/inference.js";
import type {
  AnonymousDecision,
  ModelMetadata,
  TierMap,
} from "./catalog-types.js";

// CatalogOptions are the settings the catalog needs to route.
export interface CatalogOptions {
  prefer: Tier;
  protocols: Record<string, string>;
  freeOnly: boolean;
}

// CatalogState is the discovered model data the catalog routes on.
export interface CatalogState {
  zen: Record<string, boolean>;
  go: Record<string, boolean>;
  nativeProtocols: TierMap<Record<string, Protocol>>;
  unsupported: TierMap<Record<string, boolean>>;
  metadata: TierMap<Record<string, ModelMetadata>>;
  disabled: Set<string>;
  updatedAt: number;
  cacheSource: "none" | "live" | "disk";
  refreshAfter: number;
}

// emptyCatalogState builds a state with no discovered model.
export function emptyCatalogState(): CatalogState {
  return {
    zen: {},
    go: {},
    nativeProtocols: { zen: {}, go: {} },
    unsupported: { zen: {}, go: {} },
    metadata: { zen: {}, go: {} },
    disabled: new Set<string>(),
    updatedAt: 0,
    cacheSource: "none",
    refreshAfter: 300,
  };
}

// tierModels returns the models a tier advertises.
export function tierModels(
  state: CatalogState,
  tier: Tier,
): string[] {
  const source = tier === "go" ? state.go : state.zen;
  return Object.keys(source)
    .filter((model) => source[model] === true)
    .sort();
}

// modelIDs returns the sorted union of the models both tiers advertise.
export function modelIDs(state: CatalogState): string[] {
  return [
    ...new Set([...tierModels(state, "zen"), ...tierModels(state, "go")]),
  ].sort();
}

// isPending reports whether the catalog has not been filled yet. While it is
// pending every model is supported, so a temporary discovery failure does not
// take the gateway offline.
export function isPending(state: CatalogState): boolean {
  return Object.keys(state.zen).length === 0 && Object.keys(state.go).length === 0;
}

// tierSupported reports whether a tier can carry a model's protocol. A
// configured override always can; otherwise the tier's capability data
// decides, and a model it does not know is accepted only while the catalog
// is pending.
export function tierSupported(
  state: CatalogState,
  options: CatalogOptions,
  model: string,
  tier: Tier,
): boolean {
  if (options.protocols[model] !== undefined) {
    return true;
  }
  if (state.unsupported[tier][model] === true) {
    return false;
  }
  if (state.nativeProtocols[tier][model] !== undefined) {
    return true;
  }
  return isPending(state);
}

// protocolFor resolves the protocol of a model on a tier: the configured
// override first, then the tier's capability data, then Chat.
export function protocolFor(
  state: CatalogState,
  options: CatalogOptions,
  model: string,
  tier: Tier,
): Protocol {
  const configured = options.protocols[model];
  if (configured !== undefined && configured !== "") {
    return configured as Protocol;
  }
  const native = state.nativeProtocols[tier][model];
  if (native !== undefined) {
    return native;
  }
  return "chat";
}

// protocolsFor resolves the protocol of every tier in keyTiers, plus Zen
// when includeZen is set for an anonymous route.
export function protocolsFor(
  state: CatalogState,
  options: CatalogOptions,
  model: string,
  keyTiers: Tier[],
  includeZen: boolean,
): TierMap<Protocol> {
  const protocols: TierMap<Protocol> = { zen: "chat", go: "chat" };
  if (includeZen) {
    protocols.zen = protocolFor(state, options, model, "zen");
  }
  for (const tier of keyTiers) {
    protocols[tier] = protocolFor(state, options, model, tier);
  }
  return protocols;
}

// keyTierOrder builds an authenticated route in prefer order. A tier is
// included only when it has a key, advertises the model, and can carry its
// protocol.
export function keyTierOrder(
  state: CatalogState,
  options: CatalogOptions,
  model: string,
  hasZenKeys: boolean,
  hasGoKeys: boolean,
): Tier[] {
  const pending = isPending(state);
  const order: Tier[] =
    options.prefer === "go" ? ["go", "zen"] : ["zen", "go"];
  const result: Tier[] = [];
  for (const tier of order) {
    const hasKeys = tier === "go" ? hasGoKeys : hasZenKeys;
    if (!hasKeys) {
      continue;
    }
    const advertised = tier === "go" ? state.go[model] : state.zen[model];
    if (!pending && advertised !== true) {
      continue;
    }
    if (!tierSupported(state, options, model, tier)) {
      continue;
    }
    result.push(tier);
  }
  return result;
}

// supported reports whether some tier advertises a model with a usable
// protocol. Every model is supported while the catalog is still pending.
export function supported(
  state: CatalogState,
  options: CatalogOptions,
  model: string,
): boolean {
  if (isPending(state)) {
    return true;
  }
  if (state.zen[model] === true && tierSupported(state, options, model, "zen")) {
    return true;
  }
  if (state.go[model] === true && tierSupported(state, options, model, "go")) {
    return true;
  }
  return false;
}

// emptyMetadata builds the zero metadata of a model neither source describes.
export function emptyMetadata(): ModelMetadata {
  return {
    contextWindow: 0,
    maxInput: 0,
    maxOutput: 0,
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    inputModalities: [],
    outputModalities: [],
  };
}

export type { AnonymousDecision, ModelMetadata, TierMap, Route };
