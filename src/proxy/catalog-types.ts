import type { Protocol, Tier } from "../types/config.js";

// TierMap holds one value per tier.
export type TierMap<T> = Record<Tier, T>;

// ModelMetadata is the rich per-model description the OpenCode capability
// catalog carries. The same-named model can have different limits per tier, so
// every lookup passes the tier that will serve the request.
export interface ModelMetadata {
  contextWindow: number;
  maxInput: number;
  maxOutput: number;
  reasoning: boolean;
  toolCall: boolean;
  structuredOutput: boolean;
  inputModalities: string[];
  outputModalities: string[];
}

// AnonymousDecision explains whether a model may be served on the anonymous
// lane and why.
export interface AnonymousDecision {
  allowed: boolean;
  source: string;
}

// RouteDiagnostic explains the protocol choice and the route of a model.
export interface RouteDiagnostic {
  model: string;
  requestedProtocol: Protocol;
  nativeProtocol: Protocol;
  nativeProtocols: TierMap<Protocol>;
  protocolSource: "configured" | "default" | "upstream";
  availableZen: boolean;
  availableGo: boolean;
  tier: Tier | "";
  anonymous: boolean;
  keyTiers: Tier[];
  anonymousEligibility: AnonymousDecision;
  routeError: string;
}

// CatalogSnapshot summarizes the catalog without route filtering.
export interface CatalogSnapshot {
  zen: number;
  go: number;
  total: number;
  exposed: number;
  updatedAt: number;
  cacheSource: "none" | "live" | "disk";
  stale: boolean;
}

// emptyTierMap builds a tier map with the same value on every tier.
export function emptyTierMap<T>(value: T): TierMap<T> {
  return { zen: value, go: value };
}
