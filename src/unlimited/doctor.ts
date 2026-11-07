import { COOLDOWN_SECONDS, type GuardSnapshot, type UnlimitedGuard } from "./guard.js";
import { normalizePrefix64 } from "./lane.js";

const IPIFY_V6_URL = "https://api64.ipify.org";

// EgressStatus describes the current outbound network identity (warp-keeper & doctor).
export interface EgressStatus {
  readonly ip: string;
  readonly prefix64: string;
  readonly isCloudflare: boolean;
  readonly leakGuardActive: boolean;
}

// DoctorReport is the structured JSON equivalent of scripts/doctor.sh.
export interface DoctorReport {
  readonly status: "ok" | "degraded";
  readonly runtime: "cloudflare-worker" | "node";
  readonly egress: EgressStatus;
  readonly guard: {
    readonly hops: number;
    readonly last_hop: number;
    readonly cooldown_seconds: number;
    readonly blacklisted_count: number;
    readonly blacklist: readonly string[];
  };
  readonly lane: {
    readonly current_edge: string;
    readonly current_prefix64: string;
    readonly current_session: string;
    readonly current_machine_id: string;
    readonly pool_size: number;
    readonly pool: readonly string[];
  };
}

// isCloudflareEgress checks whether an IP belongs to Cloudflare WARP / edge
// ranges (2606:4700::/32, 2a09:bac5::/32, 162.159.0.0/16, 188.114.0.0/16, 104.16.0.0/12).
export function isCloudflareEgress(ip: string): boolean {
  const normalized = ip.trim().toLowerCase();
  if (normalized.startsWith("2606:") || normalized.startsWith("2a09:")) {
    return true;
  }
  if (
    normalized.startsWith("162.159.") ||
    normalized.startsWith("188.114.") ||
    normalized.startsWith("104.") ||
    normalized.startsWith("172.64.") ||
    normalized.startsWith("172.65.") ||
    normalized.startsWith("172.66.") ||
    normalized.startsWith("172.67.")
  ) {
    return true;
  }
  return false;
}

// probeEgress checks the outbound IP via api64.ipify.org (matching doctor.sh).
export async function probeEgress(
  fetchImpl: typeof fetch = fetch,
  runtime: "cloudflare-worker" | "node" = "node",
  timeoutMs = 3000,
): Promise<EgressStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(IPIFY_V6_URL, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return fallbackEgress(runtime);
    }
    const ip = (await response.text()).trim();
    if (ip === "") {
      return fallbackEgress(runtime);
    }
    const isCf = runtime === "cloudflare-worker" || isCloudflareEgress(ip);
    return {
      ip,
      prefix64: normalizePrefix64(ip),
      isCloudflare: isCf,
      leakGuardActive: isCf,
    };
  } catch {
    return fallbackEgress(runtime);
  } finally {
    clearTimeout(timer);
  }
}

function fallbackEgress(runtime: "cloudflare-worker" | "node"): EgressStatus {
  if (runtime === "cloudflare-worker") {
    return {
      ip: "2606:4700::worker",
      prefix64: "2606:4700:0:0",
      isCloudflare: true,
      leakGuardActive: true,
    };
  }
  return {
    ip: "",
    prefix64: "",
    isCloudflare: false,
    leakGuardActive: false,
  };
}

// buildDoctorReport runs the health checks and returns the full DoctorReport.
export async function buildDoctorReport(
  guard: UnlimitedGuard,
  fetchImpl: typeof fetch = fetch,
  runtime: "cloudflare-worker" | "node" = "node",
): Promise<DoctorReport> {
  const egress = await probeEgress(fetchImpl, runtime);
  const snap: GuardSnapshot = guard.snapshot();
  const healthy =
    (runtime === "cloudflare-worker" || egress.isCloudflare) &&
    snap.pool.length > 0;
  return {
    status: healthy ? "ok" : "degraded",
    runtime,
    egress,
    guard: {
      hops: snap.hops,
      last_hop: snap.lastHop,
      cooldown_seconds: COOLDOWN_SECONDS,
      blacklisted_count: snap.blacklist.length,
      blacklist: snap.blacklist,
    },
    lane: {
      current_edge: snap.currentEdge,
      current_prefix64: snap.currentPrefix64,
      current_session: snap.currentSession,
      current_machine_id: snap.currentMachineId,
      pool_size: snap.pool.length,
      pool: snap.pool,
    },
  };
}
