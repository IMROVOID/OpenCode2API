import { firstString, stringAt } from "./json-util.js";

// sprint mirrors Go's fmt.Sprint for the values a stream event can carry: a
// number, a string, or a missing value that Go prints as "<nil>".
export function sprint(value: unknown): string {
  if (value === undefined || value === null) {
    return "<nil>";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

// mergeToolName folds a Chat name fragment into the name accumulated so far. A
// fragment that repeats or extends the current name replaces it, and anything
// else is appended.
export function mergeToolName(current: string, fragment: string): string {
  if (current === "" || fragment === current) {
    return fragment;
  }
  if (fragment.startsWith(current)) {
    return fragment;
  }
  return current + fragment;
}

// responseToolKey identifies the tool call a Responses event belongs to: the
// item's id when the event carries an item, else the event's item_id, else its
// output_index.
export function responseToolKey(
  event: Record<string, unknown>,
  item: Record<string, unknown> | undefined,
): string {
  if (item !== undefined) {
    const id = stringAt(item, "id");
    if (id !== "") {
      return id;
    }
  }
  const id = stringAt(event, "item_id");
  if (id !== "") {
    return id;
  }
  return sprint(event["output_index"]);
}

// streamErrorMessage extracts the upstream error text, accepting the OpenAI
// nested error object, a top-level message and a bare error string.
export function streamErrorMessage(
  value: Record<string, unknown>,
  fallback: string,
): string {
  const nested = stringAt(value, "error", "message");
  if (nested !== "") {
    return nested;
  }
  const top = stringAt(value, "message");
  if (top !== "") {
    return top;
  }
  const bare = value["error"];
  if (typeof bare === "string" && bare !== "") {
    return bare;
  }
  return fallback;
}

// streamErrorType extracts the upstream error type, falling back to its code
// and then to "upstream_error".
export function streamErrorType(value: Record<string, unknown>): string {
  return firstString(
    stringAt(value, "error", "type"),
    stringAt(value, "error", "code"),
    "upstream_error",
  );
}

// isStreamErrorFinish reports whether a finish or stop reason reports an
// upstream error rather than a normal end.
export function isStreamErrorFinish(stop: string): boolean {
  const normalized = stop.trim().toLowerCase();
  return (
    normalized === "error" ||
    normalized === "network_error" ||
    normalized === "server_error"
  );
}

// ToolTracker remembers the tool calls a stream has seen. It keeps the
// identity of each call, the order the calls appeared in, and whether their
// arguments or reasoning already arrived, so a call is only started once and
// a delta is not repeated by the closing event.
export class ToolTracker {
  private readonly started = new Map<string, boolean>();
  private readonly ids = new Map<string, string>();
  private readonly names = new Map<string, string>();
  private readonly order: string[] = [];
  private readonly argumentKeys = new Set<string>();
  private readonly reasoningKeys = new Set<string>();

  // ensure registers a tool key the first time it is seen and keeps the order
  // in which the calls appeared.
  ensure(key: string): void {
    if (this.started.has(key)) {
      return;
    }
    this.started.set(key, false);
    this.order.push(key);
  }

  setID(key: string, id: string): void {
    if (id !== "") {
      this.ids.set(key, id);
    }
  }

  setName(key: string, name: string): void {
    if (name !== "") {
      this.names.set(key, name);
    }
  }

  id(key: string): string {
    return this.ids.get(key) ?? "";
  }

  name(key: string): string {
    return this.names.get(key) ?? "";
  }

  isStarted(key: string): boolean {
    return this.started.get(key) === true;
  }

  markStarted(key: string): void {
    this.started.set(key, true);
  }

  keys(): string[] {
    return [...this.order];
  }

  markArguments(key: string): void {
    this.argumentKeys.add(key);
  }

  hasArguments(key: string): boolean {
    return this.argumentKeys.has(key);
  }

  markReasoning(key: string): void {
    this.reasoningKeys.add(key);
  }

  hasReasoning(key: string): boolean {
    return this.reasoningKeys.has(key);
  }
}
