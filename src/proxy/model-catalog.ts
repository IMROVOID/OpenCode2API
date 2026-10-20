import type { Protocol, Tier } from "../types/config.js";
import type { Route } from "../types/inference.js";
import {
  emptyCapabilities,
  isFreeModel,
  nameDecision,
  parseCapabilities,
  parseModels,
  parseProtocolDocs,
  type Capabilities,
} from "./model-discovery.js";
import {
  emptyCatalogState,
  emptyMetadata,
  isPending,
  keyTierOrder,
  modelIDs,
  protocolFor,
  protocolsFor,
  supported,
  tierModels,
  tierSupported,
  type CatalogOptions,
  type CatalogState,
} from "./catalog-state.js";
import type {
  AnonymousDecision,
  CatalogSnapshot,
  ModelMetadata,
  RouteDiagnostic,
  TierMap,
} from "./catalog-types.js";

// ModelCatalog holds the discovered models and plans how each one is served.
export class ModelCatalog {
  private readonly state: CatalogState = emptyCatalogState();
  private options: CatalogOptions;

  constructor(options: CatalogOptions) {
    this.options = options;
  }

  // setOptions replaces the routing options, so a configuration change takes
  // effect on the next request.
  setOptions(options: CatalogOptions): void {
    this.options = options;
  }

  // isEmpty reports whether no model has been discovered yet.
  isEmpty(): boolean {
    return isPending(this.state);
  }

  // isPending reports whether the catalog has not been filled yet.
  isPending(): boolean {
    return isPending(this.state);
  }

  // tierModels returns the models a tier advertises.
  tierModels(tier: Tier): string[] {
    return tierModels(this.state, tier);
  }

  // modelIDs returns the sorted union of the models both tiers advertise.
  modelIDs(): string[] {
    return modelIDs(this.state);
  }

  // list returns the sorted ids of the advertised models that have a usable
  // protocol on a tier advertising them. It ignores credentials, availability
  // and models.free_only.
  list(): string[] {
    return this.modelIDs().filter((model) => this.supported(model));
  }

  // supported reports whether some tier advertises a model with a usable
  // protocol.
  supported(model: string): boolean {
    return supported(this.state, this.options, model);
  }

  // route plans how a model is served given which credentials exist. A free
  // model can start on the anonymous lane when the anonymous lane is enabled;
  // otherwise, and as the fallback, the key tiers are tried in prefer order.
  route(
    model: string,
    hasZenKeys: boolean,
    hasGoKeys: boolean,
    hasAnonymous: boolean,
  ): Route {
    if (this.state.disabled.has(model)) {
      throw new Error(
        `model ${JSON.stringify(model)} is disabled after a failed availability check; restore it in the WebUI or wait for the next probe`,
      );
    }
    this.checkFreeOnly(model);
    const keyTiers = keyTierOrder(
      this.state,
      this.options,
      model,
      hasZenKeys,
      hasGoKeys,
    );
    // OpenCode's public credential belongs to the Zen tier. Every free model
    // starts there unless the Zen capability data marks it unsupported, even if
    // the current catalog only advertises it on Go: an upstream rejection will
    // move the request into the authenticated fallback plan.
    const decision = this.anonymousDecision(model);
    const advertised =
      this.state.zen[model] === true || this.state.go[model] === true;
    if (
      hasAnonymous &&
      decision.allowed &&
      (this.options.protocols[model] !== undefined ||
        this.state.unsupported.zen[model] !== true) &&
      (isPending(this.state) || advertised)
    ) {
      const protocols = protocolsFor(
        this.state,
        this.options,
        model,
        keyTiers,
        true,
      );
      return {
        id: model,
        tier: "zen",
        protocol: protocols.zen,
        protocols,
        anonymous: true,
        keyTiers,
      };
    }
    if (keyTiers.length > 0) {
      const tier = keyTiers[0] as Tier;
      const protocols = protocolsFor(
        this.state,
        this.options,
        model,
        keyTiers,
        false,
      );
      return {
        id: model,
        tier,
        protocol: protocols[tier],
        protocols,
        anonymous: false,
        keyTiers,
      };
    }
    throw new Error(
      `model ${JSON.stringify(model)} is not available in the configured Zen or Go pools`,
    );
  }

  // routeForTier builds a route pinned to one tier, used by the Playground's
  // per-key diagnostics. It never selects the anonymous lane and never adds a
  // fallback tier.
  routeForTier(
    model: string,
    tier: Tier,
    hasZenKeys: boolean,
    hasGoKeys: boolean,
  ): Route {
    const hasKeys = tier === "go" ? hasGoKeys : hasZenKeys;
    if (!hasKeys) {
      throw new Error(`no ${tier} key is configured`);
    }
    if (this.state.disabled.has(model)) {
      throw new Error(
        `model ${JSON.stringify(model)} is disabled after a failed availability check`,
      );
    }
    this.checkFreeOnly(model);
    const advertised =
      tier === "go" ? this.state.go[model] : this.state.zen[model];
    if (!isPending(this.state) && advertised !== true) {
      throw new Error(
        `model ${JSON.stringify(model)} is not available in the selected ${tier} key tier`,
      );
    }
    if (!tierSupported(this.state, this.options, model, tier)) {
      throw new Error(
        `model ${JSON.stringify(model)} uses an upstream protocol that is not available on the selected ${tier} key tier`,
      );
    }
    const protocol = protocolFor(this.state, this.options, model, tier);
    return {
      id: model,
      tier,
      protocol,
      protocols: {
        zen: tier === "zen" ? protocol : "chat",
        go: tier === "go" ? protocol : "chat",
      },
      anonymous: false,
      keyTiers: [tier],
    };
  }

  // diagnostic explains the protocol choice and the route of a model. It never
  // fails: a routing error is reported in routeError.
  diagnostic(
    model: string,
    requested: Protocol,
    hasZenKeys: boolean,
    hasGoKeys: boolean,
    hasAnonymous: boolean,
  ): RouteDiagnostic {
    const configured = this.options.protocols[model];
    const explicit = configured !== undefined && configured !== "";
    const zenKnown = this.state.nativeProtocols.zen[model] !== undefined;
    const goKnown = this.state.nativeProtocols.go[model] !== undefined;
    const nativeProtocols: TierMap<Protocol> = {
      zen: protocolFor(this.state, this.options, model, "zen"),
      go: protocolFor(this.state, this.options, model, "go"),
    };
    let source: RouteDiagnostic["protocolSource"] = "configured";
    if (!explicit) {
      source = zenKnown || goKnown ? "upstream" : "default";
    }
    let protocol = explicit ? (configured as Protocol) : nativeProtocols.zen;
    if (!explicit && this.options.prefer === "go") {
      protocol = nativeProtocols.go;
    }
    const diagnostic: RouteDiagnostic = {
      model,
      requestedProtocol: requested,
      nativeProtocol: protocol,
      nativeProtocols,
      protocolSource: source,
      availableZen: this.state.zen[model] === true,
      availableGo: this.state.go[model] === true,
      tier: "",
      anonymous: false,
      keyTiers: [],
      anonymousEligibility: this.anonymousDecision(model),
      routeError: "",
    };
    try {
      const route = this.route(model, hasZenKeys, hasGoKeys, hasAnonymous);
      diagnostic.nativeProtocol = route.protocol;
      diagnostic.nativeProtocols = route.protocols;
      diagnostic.tier = route.tier;
      diagnostic.anonymous = route.anonymous;
      diagnostic.keyTiers = [...route.keyTiers];
    } catch (error) {
      diagnostic.routeError = error instanceof Error ? error.message : String(error);
    }
    return diagnostic;
  }

  // availableModels provides discovery and readiness with the same route
  // filtering, including configured key tiers and anonymous eligibility.
  availableModels(
    hasZenKeys: boolean,
    hasGoKeys: boolean,
    hasAnonymous: boolean,
  ): { routes: Route[]; snapshot: CatalogSnapshot } {
    const routes: Route[] = [];
    for (const model of this.modelIDs()) {
      if (!this.supported(model)) {
        continue;
      }
      try {
        routes.push(this.route(model, hasZenKeys, hasGoKeys, hasAnonymous));
      } catch {
        // A model that cannot be routed is not exposed.
      }
    }
    const snapshot = this.snapshot();
    snapshot.exposed = routes.length;
    return { routes, snapshot };
  }

  // snapshot summarizes the catalog without route filtering.
  snapshot(): CatalogSnapshot {
    const ids = this.modelIDs();
    let exposed = 0;
    for (const model of ids) {
      if (this.supported(model)) {
        exposed += 1;
      }
    }
    let stale = this.state.cacheSource === "disk";
    if (this.state.updatedAt > 0 && this.state.refreshAfter > 0) {
      const limit = Math.max(2 * this.state.refreshAfter, 60);
      stale = stale || Date.now() - this.state.updatedAt > limit * 1000;
    }
    return {
      zen: Object.keys(this.state.zen).length,
      go: Object.keys(this.state.go).length,
      total: ids.length,
      exposed,
      updatedAt: this.state.updatedAt,
      cacheSource: this.state.cacheSource,
      stale,
    };
  }

  // metadataForTier returns the rich per-model metadata for the tier that
  // will actually serve the request.
  metadataForTier(model: string, tier: Tier): ModelMetadata {
    return this.state.metadata[tier][model] ?? emptyMetadata();
  }

  // anonymousDecision reports whether a model may be served on the anonymous
  // lane.
  anonymousDecision(model: string): AnonymousDecision {
    return nameDecision(model);
  }

  // isFree reports whether the catalog considers the model free-tier.
  isFree(model: string): boolean {
    return this.anonymousDecision(model).allowed;
  }

  // setDisabled marks a model as unavailable after a failed availability check.
  setDisabled(model: string, disabled: boolean): void {
    if (disabled) {
      this.state.disabled.add(model);
    } else {
      this.state.disabled.delete(model);
    }
  }

  // disabledModels lists the models a failed availability check disabled.
  disabledModels(): string[] {
    return [...this.state.disabled].sort();
  }

  // applyTier replaces the models a tier advertises.
  applyTier(tier: Tier, models: string[]): void {
    const target: Record<string, boolean> = {};
    for (const model of models) {
      target[model] = true;
    }
    if (tier === "go") {
      this.state.go = target;
    } else {
      this.state.zen = target;
    }
  }

  // applyCapabilities replaces the capability data of both tiers.
  applyCapabilities(capabilities: Capabilities): void {
    this.state.nativeProtocols = {
      zen: { ...capabilities.protocols.zen },
      go: { ...capabilities.protocols.go },
    };
    this.state.unsupported = {
      zen: { ...capabilities.unsupported.zen },
      go: { ...capabilities.unsupported.go },
    };
    this.state.metadata = {
      zen: { ...capabilities.metadata.zen },
      go: { ...capabilities.metadata.go },
    };
  }

  // markLive records that the catalog was filled from the live endpoints.
  markLive(refreshAfter: number): void {
    this.state.updatedAt = Date.now();
    this.state.cacheSource = "live";
    this.state.refreshAfter = refreshAfter;
  }

  // markDisk records that the catalog was loaded from the cache file.
  markDisk(refreshAfter: number): void {
    this.state.cacheSource = "disk";
    this.state.refreshAfter = refreshAfter;
  }

  // checkFreeOnly rejects a model that is not free when free_only is enabled.
  private checkFreeOnly(model: string): void {
    if (!this.options.freeOnly) {
      return;
    }
    if (!this.isFree(model)) {
      throw new Error(
        `model ${JSON.stringify(model)} is not free and models.free_only is enabled`,
      );
    }
  }
}

export {
  emptyCapabilities,
  isFreeModel,
  nameDecision,
  parseCapabilities,
  parseModels,
  parseProtocolDocs,
};
export type {
  AnonymousDecision,
  CatalogOptions,
  CatalogSnapshot,
  ModelMetadata,
  RouteDiagnostic,
  TierMap,
};
