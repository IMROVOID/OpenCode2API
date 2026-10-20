import { fingerprintSecret } from "../config/secrets.js";

// The base cooldown a failing key is held back for, and the largest multiple
// of it the cooldown grows to.
const MAX_COOLDOWN_MULTIPLIER = 8;

// KeyNode is one upstream key in a tier's pool. It remembers how often it
// failed and until when it is held back, so a failing key is skipped for a
// while instead of being retried on every request.
export interface KeyNode {
  key: string;
  id: string;
  failures: number;
  cooldownUntil: number;
}

// KeyPool is one tier's key pool. It hands out keys in a round-robin order
// and honours the cooldown of the keys that recently failed.
export class KeyPool {
  readonly nodes: KeyNode[];
  private next = 0;

  constructor(keys: readonly string[]) {
    this.nodes = keys.map((key) => ({
      key,
      id: fingerprintSecret(key),
      failures: 0,
      cooldownUntil: 0,
    }));
  }

  // size reports how many keys the pool holds.
  size(): number {
    return this.nodes.length;
  }

  // isEmpty reports whether the pool holds no keys.
  isEmpty(): boolean {
    return this.nodes.length === 0;
  }

  // keys returns the pool's keys.
  keys(): string[] {
    return this.nodes.map((node) => node.key);
  }

  // ids returns the pool's key fingerprints.
  ids(): string[] {
    return this.nodes.map((node) => node.id);
  }

  // cursor returns a cursor over the pool. The starting node is reserved per
  // cursor, so concurrent requests start on different keys.
  cursor(): KeyCursor {
    if (this.nodes.length === 0) {
      return new KeyCursor(this, 0);
    }
    const start = this.next % this.nodes.length;
    this.next = (this.next + 1) % this.nodes.length;
    return new KeyCursor(this, start);
  }

  // cursorFor returns a cursor whose first choice is stable for the supplied
  // affinity key, so every turn of a conversation stays on the same upstream
  // key. An empty affinity keeps the round-robin behavior.
  cursorFor(affinity: string): KeyCursor {
    if (affinity === "" || this.nodes.length === 0) {
      return this.cursor();
    }
    let hash = 0xcbf29ce484222325n;
    for (const byte of Buffer.from(affinity, "utf8")) {
      hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return new KeyCursor(this, Number(hash % BigInt(this.nodes.length)));
  }

  // markSuccess clears a key's failure count and cooldown.
  markSuccess(node: KeyNode): void {
    node.failures = 0;
    node.cooldownUntil = 0;
  }

  // markFailure cools a key down after an error or a 401, 403, 429 or 5xx
  // response; any other response leaves it untouched. The cooldown doubles
  // with each consecutive failure, from the base cooldown up to eight times
  // it, and a longer Retry-After is honored in full.
  markFailure(
    node: KeyNode,
    status: number,
    retryAfter: number,
    cooldownSeconds: number,
    now: number = Date.now(),
  ): void {
    const failed =
      status === 0 ||
      status === 401 ||
      status === 403 ||
      status === 429 ||
      status >= 500;
    if (!failed) {
      return;
    }
    node.failures += 1;
    const multiplier = 2 ** Math.min(node.failures - 1, 3);
    let delay = cooldownSeconds * 1000 * multiplier;
    delay = Math.min(delay, cooldownSeconds * 1000 * MAX_COOLDOWN_MULTIPLIER);
    if (retryAfter > delay) {
      delay = retryAfter;
    }
    node.cooldownUntil = now + delay;
  }
}

// KeyCursor walks a pool's keys. It prefers a key that is not cooling down
// and moves past the key it returned, so the next call continues the
// round-robin.
export class KeyCursor {
  private readonly pool: KeyPool;
  private position: number;

  constructor(pool: KeyPool, start: number) {
    this.pool = pool;
    this.position = start;
  }

  // next returns the key to try, or undefined when the pool is empty.
  next(): KeyNode | undefined {
    const nodes = this.pool.nodes;
    if (nodes.length === 0) {
      return undefined;
    }
    const now = Date.now();
    let ready = -1;
    let earliest = -1;
    let earliestUntil = 0;
    for (let offset = 0; offset < nodes.length; offset += 1) {
      const index = (this.position + offset) % nodes.length;
      const node = nodes[index];
      if (node === undefined) {
        continue;
      }
      if (node.cooldownUntil <= now) {
        ready = index;
        break;
      }
      if (earliest < 0 || node.cooldownUntil < earliestUntil) {
        earliest = index;
        earliestUntil = node.cooldownUntil;
      }
    }
    const choice = ready >= 0 ? ready : earliest;
    if (choice < 0) {
      return undefined;
    }
    this.position = (choice + 1) % nodes.length;
    return nodes[choice];
  }
}

// parseRetryAfter reads a Retry-After header in delta-seconds or HTTP-date
// form. It returns 0 for an empty, non-positive or unparsable value and for
// a date already in the past.
export function parseRetryAfter(value: string, now: number = Date.now()): number {
  const trimmed = value.trim();
  if (trimmed === "") {
    return 0;
  }
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && Number.isInteger(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) {
    return 0;
  }
  return Math.max(when - now, 0);
}
