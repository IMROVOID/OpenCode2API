import {
  DEFAULT_AAAA_POOL,
  createLaneIdentity,
  normalizePrefix64,
  type LaneIdentity,
} from "./lane.js";

// Constants from scripts/zen-guard.sh.
export const COOLDOWN_SECONDS = 75;
export const MAX_HOP_TRIES = 8;
export const BLACKLIST_MAX = 200;

// GuardSnapshot describes the current state of the self-healing guard.
export interface GuardSnapshot {
  readonly blacklist: readonly string[];
  readonly lastHop: number;
  readonly hops: number;
  readonly currentEdge: string;
  readonly currentPrefix64: string;
  readonly currentSession: string;
  readonly currentMachineId: string;
  readonly pool: readonly string[];
}

// GuardAttemptResult is the outcome of one guarded upstream call.
export interface GuardAttemptResult<T> {
  readonly status: number;
  readonly bodyPreview: string;
  readonly value: T;
}

// isQuotaWall detects OpenCode's free usage wall from HTTP status and/or
// response text (matches zen-guard.sh QuotaExceeded & Free usage limit checks).
export function isQuotaWall(status: number, bodyText: string): boolean {
  if (status === 429) {
    return true;
  }
  const lower = bodyText.toLowerCase();
  if (
    lower.includes("quotaexceeded") ||
    lower.includes("free usage limit reached") ||
    lower.includes("freetiererror") ||
    lower.includes("rate_limit_exceeded")
  ) {
    return true;
  }
  return false;
}

// UnlimitedGuard implements zen-guard and zen-hop: /64 prefix blacklisting,
// oldest-block recycling, manual hop, and up-to-8-try self-healing rotation.
export class UnlimitedGuard {
  private blacklist: string[] = [];
  private lastHop = 0;
  private hops = 0;
  private pool: string[];
  private activeLane: LaneIdentity;
  private readonly scope: string;

  constructor(
    initialPool: readonly string[] = DEFAULT_AAAA_POOL,
    scope = "unlimited",
  ) {
    this.scope = scope;
    this.pool =
      initialPool.length > 0 ? [...initialPool] : [...DEFAULT_AAAA_POOL];
    this.activeLane = createLaneIdentity(this.scope, this.pool[0] ?? DEFAULT_AAAA_POOL[0]);
  }

  // current returns the active lane identity and edge.
  current(): LaneIdentity {
    return this.activeLane;
  }

  // setPool updates the known AAAA edge pool.
  setPool(pool: readonly string[]): void {
    if (pool.length > 0) {
      this.pool = [...pool];
    }
  }

  // blacklistAdd normalizes an IPv6 address to its /64 prefix and appends it
  // to the lifetime blacklist (capped at BLACKLIST_MAX = 200).
  blacklistAdd(ipv6: string): void {
    const prefix = normalizePrefix64(ipv6);
    if (prefix === "") {
      return;
    }
    const filtered = this.blacklist.filter(
      (entry) => entry !== "" && normalizePrefix64(entry) !== prefix,
    );
    const updated = [...filtered, prefix];
    this.blacklist = updated.slice(-BLACKLIST_MAX);
  }

  // isBurnt reports whether an IPv6 address belongs to a blacklisted /64 block.
  isBurnt(ipv6: string): boolean {
    const prefix = normalizePrefix64(ipv6);
    if (prefix === "") {
      return false;
    }
    return this.blacklist.some(
      (entry) => entry !== "" && normalizePrefix64(entry) === prefix,
    );
  }

  // hop blacklists the current edge (when requested), selects a fresh unburned
  // edge (or recycles the oldest block when all are burned), and rotates the
  // device/session/project identity.
  hop(
    candidatePool?: readonly string[],
    burnCurrent = false,
    nowSeconds: number = Math.floor(Date.now() / 1000),
  ): LaneIdentity {
    if (burnCurrent) {
      this.blacklistAdd(this.activeLane.edge);
    }
    const effectivePool =
      candidatePool !== undefined && candidatePool.length > 0
        ? [...candidatePool]
        : this.pool;
    let chosen = "";
    let tries = 0;
    while (tries < MAX_HOP_TRIES) {
      const candidate =
        effectivePool[(this.hops + tries) % effectivePool.length] ??
        DEFAULT_AAAA_POOL[0];
      tries += 1;
      if (!this.isBurnt(candidate)) {
        chosen = candidate;
        break;
      }
    }
    // Every block in the pool is blacklisted -> recycle the oldest /64 block
    // (buckets reset daily around midnight, matching zen-guard.sh lines 154-159).
    if (chosen === "") {
      const oldestPrefix = this.blacklist[0];
      if (oldestPrefix !== undefined) {
        this.blacklist = this.blacklist.slice(1);
        const match = effectivePool.find(
          (edge) => normalizePrefix64(edge) === oldestPrefix,
        );
        chosen = match ?? effectivePool[0] ?? DEFAULT_AAAA_POOL[0];
      } else {
        chosen = effectivePool[0] ?? DEFAULT_AAAA_POOL[0];
      }
    }
    this.hops += 1;
    this.lastHop = nowSeconds;
    this.activeLane = createLaneIdentity(this.scope, chosen);
    return this.activeLane;
  }

  // executeWithGuard runs an upstream attempt and automatically hops up to
  // MAX_HOP_TRIES times when a quota wall is encountered.
  async executeWithGuard<T>(
    attemptFn: (lane: LaneIdentity, attempt: number) => Promise<GuardAttemptResult<T>>,
  ): Promise<GuardAttemptResult<T>> {
    let lane = this.activeLane;
    let lastResult = await attemptFn(lane, 1);
    if (!isQuotaWall(lastResult.status, lastResult.bodyPreview)) {
      return lastResult;
    }
    let tries = 0;
    while (tries < MAX_HOP_TRIES) {
      tries += 1;
      lane = this.hop(this.pool, true);
      lastResult = await attemptFn(lane, tries + 1);
      if (!isQuotaWall(lastResult.status, lastResult.bodyPreview)) {
        return lastResult;
      }
    }
    return lastResult;
  }

  // snapshot returns an immutable copy of the guard's state.
  snapshot(): GuardSnapshot {
    return {
      blacklist: [...this.blacklist],
      lastHop: this.lastHop,
      hops: this.hops,
      currentEdge: this.activeLane.edge,
      currentPrefix64: this.activeLane.prefix64,
      currentSession: this.activeLane.ids.session,
      currentMachineId: this.activeLane.machineId,
      pool: [...this.pool],
    };
  }
}
