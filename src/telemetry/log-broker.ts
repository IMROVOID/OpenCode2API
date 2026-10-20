import type { Usage } from "../types/inference.js";

// LogEvent is one structured log record. The sequence is monotonic and is
// the SSE event id the WebUI resumes from.
export interface LogEvent {
  sequence: number;
  time: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  component: string;
  fields: Record<string, unknown>;
}

// The minimum ring size the broker keeps.
const MIN_RING_SIZE = 100;

// The depth of a subscriber's channel. A subscriber that falls behind drops
// events, which leaves a gap in the sequence the client detects.
const SUBSCRIBER_BUFFER = 128;

type Subscriber = (event: LogEvent) => void;

// LogBroker keeps the recent log events in a ring and fans them out to the
// live subscribers.
export class LogBroker {
  private buffer: LogEvent[] = [];
  private next = 0;

  private readonly subscribers = new Map<number, Subscriber>();
  private nextSubscriber = 0;

  constructor(private capacity: number) {
    this.capacity = clampCapacity(capacity);
  }

  // resize changes the ring size, keeping the newest events.
  resize(capacity: number): void {
    const next = clampCapacity(capacity);
    if (next === this.capacity) {
      return;
    }
    this.capacity = next;
    if (this.buffer.length > next) {
      this.buffer = this.buffer.slice(this.buffer.length - next);
    }
  }

  // publish stores an event and offers it to every subscriber.
  publish(event: LogEvent): void {
    this.next += 1;
    const published: LogEvent = { ...event, sequence: this.next };
    this.buffer.push(published);
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
    for (const subscriber of [...this.subscribers.values()]) {
      subscriber(published);
    }
  }

  // recent returns the events after a cursor, oldest first, trimmed to the
  // newest limit. It reports a gap when the cursor is older than the oldest
  // retained event.
  recent(after: number, limit: number): { events: LogEvent[]; gap: boolean } {
    const first = this.buffer[0];
    const oldest = first?.sequence ?? 0;
    const gap = after > 0 && oldest > 0 && after + 1 < oldest;
    const events = this.buffer.filter((event) => event.sequence > after);
    const effective =
      limit < 1 || limit > events.length ? events.length : limit;
    return { events: events.slice(events.length - effective), gap };
  }

  // subscribe registers a live subscriber and returns the function that
  // removes it again.
  subscribe(subscriber: Subscriber): () => void {
    const id = this.nextSubscriber;
    this.nextSubscriber += 1;
    this.subscribers.set(id, subscriber);
    return () => {
      this.subscribers.delete(id);
    };
  }

  // size reports how many events the ring holds.
  size(): number {
    return this.buffer.length;
  }
}

// clampCapacity keeps the ring size within its allowed range.
function clampCapacity(capacity: number): number {
  if (!Number.isFinite(capacity) || capacity < MIN_RING_SIZE) {
    return MIN_RING_SIZE;
  }
  return Math.trunc(capacity);
}

export { SUBSCRIBER_BUFFER };

// usageLogFields turns a usage report into log fields.
export function usageLogFields(usage: Usage): Record<string, unknown> {
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
  };
}
