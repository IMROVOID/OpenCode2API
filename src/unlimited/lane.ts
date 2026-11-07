import {
  ascendingID,
  canonicalSessionID,
  randomID,
  type RequestIDs,
} from "../protocol/identity.js";
import { randomBytes, sha256Bytes, toHex } from "../protocol/sha256.js";

// Verified Cloudflare IPv6 edge literals for opencode.ai (from zen-lane.sh).
export const DEFAULT_AAAA_POOL = [
  "2606:4700:10::ac42:ad95",
  "2606:4700:10::ac42:ad96",
  "2606:4700:10::6814:2011",
] as const;

const DOH_URL = "https://1.1.1.1/dns-query?name=opencode.ai&type=AAAA";
const IPV6_HEX_COLON = /^[0-9A-Fa-f:]+$/;

// LaneIdentity represents one isolated identity + Cloudflare edge combo.
export interface LaneIdentity {
  readonly ids: RequestIDs;
  readonly machineId: string;
  readonly edge: string;
  readonly prefix64: string;
}

// normalizePrefix64 expands an IPv6 address and returns its normalized /64
// prefix (first 4 hextets). Non-IPv6 values are returned trimmed and lowercased.
export function normalizePrefix64(ipv6: string): string {
  const trimmed = ipv6.trim().toLowerCase();
  if (!trimmed.includes(":") || !IPV6_HEX_COLON.test(trimmed)) {
    return trimmed;
  }
  const expanded = expandIPv6Hextets(trimmed);
  if (expanded.length < 4) {
    return trimmed;
  }
  return expanded
    .slice(0, 4)
    .map((group) => {
      const parsed = Number.parseInt(group, 16);
      return Number.isNaN(parsed) ? "0" : parsed.toString(16);
    })
    .join(":");
}

// expandIPv6Hextets expands "::" zero-compression into 8 hextet strings.
function expandIPv6Hextets(ipv6: string): string[] {
  if (!ipv6.includes("::")) {
    return ipv6.split(":");
  }
  const [leftRaw = "", rightRaw = ""] = ipv6.split("::");
  const left = leftRaw === "" ? [] : leftRaw.split(":");
  const right = rightRaw === "" ? [] : rightRaw.split(":");
  const missing = Math.max(8 - (left.length + right.length), 0);
  const middle = new Array<string>(missing).fill("0");
  return [...left, ...middle, ...right];
}

// resolveEdgePool resolves opencode.ai AAAA records over Cloudflare DoH
// (1.1.1.1) and falls back to DEFAULT_AAAA_POOL on failure or empty result.
export async function resolveEdgePool(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3000,
): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(DOH_URL, {
      headers: { Accept: "application/dns-json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return [...DEFAULT_AAAA_POOL];
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const answers = Array.isArray(payload["Answer"]) ? payload["Answer"] : [];
    const seen = new Set<string>();
    for (const entry of answers) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const data = (entry as Record<string, unknown>)["data"];
      if (
        typeof data === "string" &&
        data.includes(":") &&
        IPV6_HEX_COLON.test(data.trim())
      ) {
        seen.add(data.trim().toLowerCase());
      }
    }
    if (seen.size === 0) {
      return [...DEFAULT_AAAA_POOL];
    }
    return [...seen].sort();
  } catch {
    return [...DEFAULT_AAAA_POOL];
  } finally {
    clearTimeout(timer);
  }
}

// createLaneIdentity generates a fresh device/session/project identity and
// binds it to the selected Cloudflare edge (zen-lane equivalent).
export function createLaneIdentity(
  scope: string,
  edge: string = DEFAULT_AAAA_POOL[0],
): LaneIdentity {
  const seed = `${scope}\0${randomID("lane", 16)}`;
  const projectDigest = sha256Bytes(`opencode-project\0${seed}`);
  const ids: RequestIDs = {
    session: canonicalSessionID(seed),
    request: randomID("req", 16),
    message: ascendingID("msg"),
    project: toHex(projectDigest.subarray(0, 20)),
    parentSession: "",
  };
  return {
    ids,
    machineId: toHex(randomBytes(16)),
    edge,
    prefix64: normalizePrefix64(edge),
  };
}

// buildEdgeFetchInit attaches Cloudflare Workers cf.resolveOverride steering
// without mutating the caller's RequestInit.
export function buildEdgeFetchInit(
  init: RequestInit,
  edge: string,
): RequestInit {
  if (edge.trim() === "") {
    return { ...init };
  }
  const existingCf =
    typeof (init as Record<string, unknown>)["cf"] === "object" &&
    (init as Record<string, unknown>)["cf"] !== null
      ? ((init as Record<string, unknown>)["cf"] as Record<string, unknown>)
      : {};
  return {
    ...init,
    cf: {
      ...existingCf,
      resolveOverride: edge,
    },
  } as RequestInit;
}
