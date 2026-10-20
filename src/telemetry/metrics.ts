import {
  emptyAttemptAggregate,
  emptyAttemptCounts,
  emptyTokenCounts,
  emptyUsagePeriod,
  LATENCY_BOUNDS,
  RECENT_ATTEMPT_CAPACITY,
  RECENT_OUTPUT_LIMIT,
  type AttemptAggregate,
  type AttemptCounts,
  type MetricSeries,
  type MetricSummary,
  type MonitorSnapshot,
  type RequestMeta,
  type ServerKeyUsage,
  type TokenCounts,
  type UpstreamAttempt,
  type UpstreamRequest,
  type UpstreamSnapshot,
  type UsageSnapshot,
} from "./metric-types.js";
import {
  addTokens,
  histogramIndex,
  histogramPercentile,
  mergeCounts,
  mergeServerKeyUsage,
  mergeTokenCounts,
  minuteStamp,
  minuteStampIndex,
  trim,
} from "./metric-helpers.js";

// The number of one-minute buckets the metrics keep.
const BUCKET_COUNT = 60;

// A minute bucket holds the counters of one minute.
interface MetricBucket {
  minute: number;
  total: number;
  success: number;
  errors: number;
  duration: number;
  histogram: number[];
  endpoints: Record<string, number>;
  models: Record<string, number>;
  tiers: Record<string, number>;
  statuses: Record<string, number>;
  usageRequests: number;
  usage_reported: number;
  tokens: TokenCounts;
  usageModels: Record<string, TokenCounts>;
  usageTiers: Record<string, TokenCounts>;
  usageSessions: Record<string, TokenCounts>;
  usageKeys: Record<string, ServerKeyUsage>;
}

// An attempt bucket holds the upstream attempts of one minute.
interface AttemptBucket {
  minute: number;
  aggregate: AttemptAggregate;
}

// emptyBucket builds a blank minute bucket.
function emptyBucket(minute: number): MetricBucket {
  return {
    minute,
    total: 0,
    success: 0,
    errors: 0,
    duration: 0,
    histogram: new Array<number>(LATENCY_BOUNDS.length + 1).fill(0),
    endpoints: {},
    models: {},
    tiers: {},
    statuses: {},
    usageRequests: 0,
    usage_reported: 0,
    tokens: emptyTokenCounts(),
    usageModels: {},
    usageTiers: {},
    usageSessions: {},
    usageKeys: {},
  };
}

// emptyAttemptBucket builds a blank attempt bucket.
function emptyAttemptBucket(minute: number): AttemptBucket {
  return { minute, aggregate: emptyAttemptAggregate() };
}

// Metrics collects the request counters, the latency histogram, the token
// usage and the upstream attempts.
export class Metrics {
  private readonly started_at = Date.now();
  private active = 0;
  private active_streams = 0;
  private total = 0;
  private success = 0;
  private errors = 0;

  private readonly buckets: MetricBucket[] = [];
  private readonly attemptBuckets: AttemptBucket[] = [];
  private readonly lifetimeUsage = emptyUsagePeriod();
  private readonly attemptLifetime = emptyAttemptAggregate();
  private readonly recentRequests: UpstreamRequest[] = [];
  private readonly recentAttempts: UpstreamAttempt[] = [];

  constructor() {
    for (let i = 0; i < BUCKET_COUNT; i++) {
      this.buckets.push(emptyBucket(0));
      this.attemptBuckets.push(emptyAttemptBucket(0));
    }
  }

  // enter counts a request that is in flight.
  enter(): void {
    this.active += 1;
  }

  // leave counts a request that finished.
  leave(): void {
    this.active -= 1;
  }

  // enterStream counts a stream that is in flight.
  enterStream(): void {
    this.active_streams += 1;
  }

  // leaveStream counts a stream that finished.
  leaveStream(): void {
    this.active_streams -= 1;
  }

  // record folds one finished request into the metrics.
  record(
    endpoint: string,
    status: number,
    duration_ms: number,
    meta: RequestMeta | undefined,
  ): void {
    const succeeded = requestSucceeded(status, meta);
    this.total += 1;
    if (succeeded) {
      this.success += 1;
    } else {
      this.errors += 1;
    }
    const minute = minuteStamp();
    const bucket = this.bucket(minute);
    bucket.total += 1;
    if (succeeded) {
      bucket.success += 1;
    } else {
      bucket.errors += 1;
    }
    const ms = Math.max(Math.trunc(duration_ms), 0);
    bucket.duration += ms;
    const index = histogramIndex(ms);
    bucket.histogram[index] = (bucket.histogram[index] ?? 0) + 1;
    bucket.endpoints[endpoint] = (bucket.endpoints[endpoint] ?? 0) + 1;
    const statusKey = String(status);
    bucket.statuses[statusKey] = (bucket.statuses[statusKey] ?? 0) + 1;
    if (meta === undefined) {
      return;
    }
    this.recordUsage(bucket, meta);
  }

  // recordUsage folds a request's usage into the bucket and the lifetime.
  private recordUsage(bucket: MetricBucket, meta: RequestMeta): void {
    if (meta.model !== "") {
      bucket.models[meta.model] = (bucket.models[meta.model] ?? 0) + 1;
    }
    if (meta.tier === "") {
      return;
    }
    bucket.tiers[meta.tier] = (bucket.tiers[meta.tier] ?? 0) + 1;
    bucket.usageRequests += 1;
    this.lifetimeUsage.requests += 1;
    if (meta.usageReported) {
      bucket.usage_reported += 1;
      this.lifetimeUsage.reported += 1;
    }
    if (meta.usage === undefined) {
      return;
    }
    addTokens(bucket.tokens, meta.usage);
    addTokens(this.lifetimeUsage.tokens, meta.usage);
    addTokens(
      bucket.usageModels[meta.model] ??
        (bucket.usageModels[meta.model] = emptyTokenCounts()),
      meta.usage,
    );
    addTokens(
      bucket.usageTiers[meta.tier] ??
        (bucket.usageTiers[meta.tier] = emptyTokenCounts()),
      meta.usage,
    );
    if (meta.session !== "") {
      addTokens(
        bucket.usageSessions[meta.session] ??
          (bucket.usageSessions[meta.session] = emptyTokenCounts()),
        meta.usage,
      );
    }
    const keyID = meta.serverKeyId;
    if (keyID === "") {
      return;
    }
    const usage = bucket.usageKeys[keyID] ?? (bucket.usageKeys[keyID] = {
      requests: 0,
      token_counts: emptyTokenCounts(),
    });
    usage.requests += 1;
    addTokens(usage.token_counts, meta.usage);
    const lifetime = this.lifetimeUsage.server_keys[keyID] ??
      (this.lifetimeUsage.server_keys[keyID] = {
        requests: 0,
        token_counts: emptyTokenCounts(),
      });
    lifetime.requests += 1;
    addTokens(lifetime.token_counts, meta.usage);
  }

  // recordAttempt folds one upstream attempt into the metrics.
  recordAttempt(attempt: UpstreamAttempt): void {
    const minute = minuteStamp();
    const bucket = this.attemptBucket(minute);
    const aggregate = bucket.aggregate;
    aggregate.total += 1;
    if (attempt.success) {
      aggregate.success += 1;
    } else {
      aggregate.failed += 1;
    }
    countAttempt(aggregate.tiers, attempt.tier || "unknown", attempt.success);
    countAttempt(
      aggregate.channels,
      attempt.channel || "unknown",
      attempt.success,
    );
    countAttempt(aggregate.keys, attempt.key_id || "unknown", attempt.success);
    aggregate.success_rate =
      aggregate.total > 0 ? aggregate.success / aggregate.total : 0;

    this.attemptLifetime.total += 1;
    if (attempt.success) {
      this.attemptLifetime.success += 1;
    } else {
      this.attemptLifetime.failed += 1;
    }
    this.attemptLifetime.success_rate =
      this.attemptLifetime.total > 0
        ? this.attemptLifetime.success / this.attemptLifetime.total
        : 0;

    this.recentAttempts.push(attempt);
    trim(this.recentAttempts, RECENT_ATTEMPT_CAPACITY);
  }

  // serverKeyUsage returns the lifetime and the last-hour usage of the local
  // server keys.
  serverKeyUsage(): {
    lifetime: Record<string, ServerKeyUsage>;
    last_hour: Record<string, ServerKeyUsage>;
  } {
    const window: Record<string, ServerKeyUsage> = {};
    for (const bucket of this.buckets) {
      if (bucket.minute === 0) {
        continue;
      }
      mergeServerKeyUsage(window, bucket.usageKeys);
    }
    return {
      lifetime: this.lifetimeUsage.server_keys,
      last_hour: window as Record<string, ServerKeyUsage>,
    };
  }

  // snapshot returns the whole metrics state.
  snapshot(): MonitorSnapshot {
    const now = Date.now();
    const series: MetricSeries[] = [];
    const endpoints: Record<string, number> = {};
    const models: Record<string, number> = {};
    const tiers: Record<string, number> = {};
    const statuses: Record<string, number> = {};
    const windowUsage = emptyUsagePeriod();
    let total = 0;
    let success = 0;
    let errors = 0;
    let duration = 0;
    const histogram = new Array<number>(LATENCY_BOUNDS.length + 1).fill(0);

    for (let offset = BUCKET_COUNT - 1; offset >= 0; offset -= 1) {
      const minute = minuteStamp() - offset * 60_000;
      const bucket = this.bucketFor(minute);
      series.unshift({
        minute: new Date(minute).toISOString(),
        total: bucket.total,
        success: bucket.success,
        errors: bucket.errors,
        input_tokens: bucket.tokens.input_tokens,
        output_tokens: bucket.tokens.output_tokens,
        cached_tokens: bucket.tokens.cached_tokens,
        reasoning_tokens: bucket.tokens.reasoning_tokens,
        total_tokens: bucket.tokens.total_tokens,
        usage_reported: bucket.usage_reported,
      });
      total += bucket.total;
      success += bucket.success;
      errors += bucket.errors;
      duration += bucket.duration;
      for (let i = 0; i < histogram.length; i += 1) {
        histogram[i] = (histogram[i] ?? 0) + (bucket.histogram[i] ?? 0);
      }
      mergeCounts(endpoints, bucket.endpoints);
      mergeCounts(models, bucket.models);
      mergeCounts(tiers, bucket.tiers);
      mergeCounts(statuses, bucket.statuses);
      windowUsage.requests += bucket.usageRequests;
      windowUsage.reported += bucket.usage_reported;
      addTokens(windowUsage.tokens, bucket.tokens);
      mergeTokenCounts(windowUsage.models, bucket.usageModels);
      mergeTokenCounts(windowUsage.tiers, bucket.usageTiers);
      mergeTokenCounts(windowUsage.sessions, bucket.usageSessions);
      mergeServerKeyUsage(windowUsage.server_keys, bucket.usageKeys);
    }
    windowUsage.coverage =
      windowUsage.requests > 0
        ? windowUsage.reported / windowUsage.requests
        : 0;

    const cutoff = now - 60 * 60 * 1000;
    const requests = this.recentRequests.filter(
      (entry) => Date.parse(entry.time) >= cutoff,
    );
    const attempts = this.recentAttempts.filter(
      (entry) => Date.parse(entry.time) >= cutoff,
    );

    const usage: UsageSnapshot = {
      lifetime: this.lifetimeUsage,
      last_hour: windowUsage,
    };
    const upstream: UpstreamSnapshot = {
      lifetime: this.attemptLifetime,
      last_hour: this.attemptAggregate(),
      requests: requests.slice(-RECENT_OUTPUT_LIMIT),
      recent: attempts.slice(-RECENT_OUTPUT_LIMIT),
    };
    return {
      started_at: new Date(this.started_at).toISOString(),
      uptime_seconds: Math.trunc((now - this.started_at) / 1000),
      active_requests: this.active,
      active_streams: this.active_streams,
      lifetime: this.lifetimeSummary(),
      last_hour: {
        total,
        success,
        errors,
        success_rate: total > 0 ? success / total : 0,
        average_ms: total > 0 ? duration / total : 0,
        p50_ms: histogramPercentile(histogram, 0.5),
        p95_ms: histogramPercentile(histogram, 0.95),
        p99_ms: histogramPercentile(histogram, 0.99),
      },
      series,
      endpoints,
      models,
      tiers,
      statuses,
      usage,
      upstream,
    };
  }

  // lifetimeSummary returns the lifetime counters. It carries no latency
  // fields, because the lifetime has no single latency distribution.
  private lifetimeSummary(): MetricSummary {
    return {
      total: this.total,
      success: this.success,
      errors: this.errors,
      success_rate: this.total > 0 ? this.success / this.total : 0,
      average_ms: 0,
      p50_ms: 0,
      p95_ms: 0,
      p99_ms: 0,
    };
  }

  // attemptAggregate returns the upstream attempts of the last hour.
  private attemptAggregate(): AttemptAggregate {
    const aggregate = emptyAttemptAggregate();
    const cutoff = minuteStamp() - (BUCKET_COUNT - 1) * 60_000;
    for (const bucket of this.attemptBuckets) {
      if (bucket.minute < cutoff || bucket.minute === 0) {
        continue;
      }
      const source = bucket.aggregate;
      aggregate.total += source.total;
      aggregate.success += source.success;
      aggregate.failed += source.failed;
      mergeAttemptCounts(aggregate.tiers, source.tiers);
      mergeAttemptCounts(aggregate.channels, source.channels);
      mergeAttemptCounts(aggregate.keys, source.keys);
    }
    aggregate.success_rate =
      aggregate.total > 0 ? aggregate.success / aggregate.total : 0;
    return aggregate;
  }

  // bucket returns the bucket of a minute, resetting it when the minute
  // changed.
  private bucket(minute: number): MetricBucket {
    const index = minuteStampIndex(minute, BUCKET_COUNT);
    const bucket = this.buckets[index];
    if (bucket === undefined) {
      throw new Error("metrics bucket index out of range");
    }
    if (bucket.minute !== minute) {
      this.buckets[index] = emptyBucket(minute);
      return this.buckets[index] as MetricBucket;
    }
    return bucket;
  }

  // bucketFor returns the bucket of a minute without creating it.
  private bucketFor(minute: number): MetricBucket {
    const index = minuteStampIndex(minute, BUCKET_COUNT);
    const bucket = this.buckets[index];
    if (bucket === undefined || bucket.minute !== minute) {
      return emptyBucket(minute);
    }
    return bucket;
  }

  // attemptBucket returns the attempt bucket of a minute.
  private attemptBucket(minute: number): AttemptBucket {
    const index = minuteStampIndex(minute, BUCKET_COUNT);
    const bucket = this.attemptBuckets[index];
    if (bucket === undefined) {
      throw new Error("metrics attempt bucket index out of range");
    }
    if (bucket.minute !== minute) {
      this.attemptBuckets[index] = emptyAttemptBucket(minute);
      return this.attemptBuckets[index] as AttemptBucket;
    }
    return bucket;
  }
}

// countAttempt folds one attempt into a per-key counter map.
function countAttempt(
  counts: Record<string, AttemptCounts>,
  key: string,
  success: boolean,
): void {
  const entry = counts[key] ?? (counts[key] = emptyAttemptCounts());
  entry.total += 1;
  if (success) {
    entry.success += 1;
  } else {
    entry.failed += 1;
  }
}

// mergeAttemptCounts folds an attempt count map into another.
function mergeAttemptCounts(
  target: Record<string, AttemptCounts>,
  source: Record<string, AttemptCounts>,
): void {
  for (const [key, value] of Object.entries(source)) {
    const entry = target[key] ?? (target[key] = emptyAttemptCounts());
    entry.total += value.total;
    entry.success += value.success;
    entry.failed += value.failed;
  }
}

// requestSucceeded reports whether a request counts as a success. Without
// metadata the request is conservatively counted as a failure.
function requestSucceeded(
  status: number,
  meta: RequestMeta | undefined,
): boolean {
  return status >= 200 && status < 400 && meta !== undefined && meta.outcome === "";
}
