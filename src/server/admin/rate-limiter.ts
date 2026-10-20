// A fixed-window rate limit counter.
interface Window {
  count: number;
  since: number;
}

// RateLimiter counts the requests of each client within a window.
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  // allow reports whether a client may make another request, and counts it.
  allow(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const window = this.windows.get(key);
    if (window === undefined || now - window.since > windowMs) {
      this.windows.set(key, { count: 1, since: now });
      this.prune(now, windowMs);
      return true;
    }
    if (window.count >= limit) {
      return false;
    }
    window.count += 1;
    return true;
  }

  // reset forgets a client's counter.
  reset(key: string): void {
    this.windows.delete(key);
  }

  // prune drops the windows that have expired.
  private prune(now: number, windowMs: number): void {
    if (this.windows.size < 1024) {
      return;
    }
    for (const [key, window] of this.windows) {
      if (now - window.since > windowMs) {
        this.windows.delete(key);
      }
    }
  }
}
