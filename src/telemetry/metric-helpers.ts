import type { Usage } from "../types/inference.js";
import { LATENCY_BOUNDS, type ServerKeyUsage, type TokenCounts } from "./metric-types.js";

// addTokens folds a usage report into a token total. The bridge usage and the
// telemetry token total name their fields differently, so the bridge usage is
// translated on the way in.
export function addTokens(
  target: TokenCounts,
  usage: Usage | TokenCounts,
): void {
  if ("inputTokens" in usage) {
    target.input_tokens += usage.inputTokens;
    target.output_tokens += usage.outputTokens;
    target.cached_tokens += usage.cachedInputTokens;
    target.reasoning_tokens += usage.reasoningTokens;
    target.total_tokens += usage.totalTokens;
    return;
  }
  target.input_tokens += usage.input_tokens;
  target.output_tokens += usage.output_tokens;
  target.cached_tokens += usage.cached_tokens;
  target.reasoning_tokens += usage.reasoning_tokens;
  target.total_tokens += usage.total_tokens;
}

// mergeCounts folds a counter map into another.
export function mergeCounts(
  target: Record<string, number>,
  source: Record<string, number>,
): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

// mergeTokenCounts folds a token map into another.
export function mergeTokenCounts(
  target: Record<string, TokenCounts>,
  source: Record<string, TokenCounts>,
): void {
  for (const [key, value] of Object.entries(source)) {
    const entry = target[key] ?? (target[key] = emptyTokens());
    addTokens(entry, value);
  }
}

// mergeServerKeyUsage folds a server-key usage map into another.
export function mergeServerKeyUsage(
  target: Record<string, ServerKeyUsage>,
  source: Record<string, ServerKeyUsage>,
): void {
  for (const [key, value] of Object.entries(source)) {
    const entry = target[key] ?? (target[key] = {
      requests: 0,
      token_counts: emptyTokens(),
    });
    entry.requests += value.requests;
    addTokens(entry.token_counts, value.token_counts);
  }
}

// emptyTokens builds a zero token total.
export function emptyTokens(): TokenCounts {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
  };
}

// histogramIndex returns the bucket a duration falls into.
export function histogramIndex(milliseconds: number): number {
  for (let i = 0; i < LATENCY_BOUNDS.length; i += 1) {
    const bound = LATENCY_BOUNDS[i];
    if (bound !== undefined && milliseconds <= bound) {
      return i;
    }
  }
  return LATENCY_BOUNDS.length;
}

// histogramPercentile returns the upper bound of the bucket holding the
// percentile. The overflow bucket reports one millisecond above the final
// bound.
export function histogramPercentile(
  histogram: number[],
  percentile: number,
): number {
  let total = 0;
  for (const count of histogram) {
    total += count;
  }
  if (total === 0) {
    return 0;
  }
  const target = Math.ceil(total * percentile);
  let seen = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    seen += histogram[i] ?? 0;
    if (seen >= target) {
      const bound = LATENCY_BOUNDS[i];
      return bound === undefined
        ? (LATENCY_BOUNDS[LATENCY_BOUNDS.length - 1] ?? 0) + 1
        : bound;
    }
  }
  return (LATENCY_BOUNDS[LATENCY_BOUNDS.length - 1] ?? 0) + 1;
}

// trim keeps the newest entries of a buffer.
export function trim<T>(buffer: T[], capacity: number): void {
  while (buffer.length > capacity) {
    buffer.shift();
  }
}

// minuteStamp returns the current minute in epoch milliseconds.
export function minuteStamp(): number {
  return Math.floor(Date.now() / 60_000) * 60_000;
}

// minuteStampIndex maps a minute onto its bucket index.
export function minuteStampIndex(minute: number, count: number): number {
  return Math.floor(minute / 60_000) % count;
}
