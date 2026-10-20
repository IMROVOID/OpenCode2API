export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringAt(
  value: unknown,
  ...path: string[]
): string {
  let current: unknown = value;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return "";
    }
    current = current[key];
  }
  return typeof current === "string" ? current : "";
}

export function numberAt(value: unknown, ...path: string[]): number | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[key];
  }
  return typeof current === "number" ? current : undefined;
}

export function boolAt(value: unknown, ...path: string[]): boolean | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[key];
  }
  return typeof current === "boolean" ? current : undefined;
}

export function mapAt(value: unknown, ...path: string[]): Record<string, unknown> {
  let current: unknown = value;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return {};
    }
    current = current[key];
  }
  return isPlainObject(current) ? current : {};
}

export function sliceAt(value: unknown, ...path: string[]): unknown[] {
  let current: unknown = value;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return [];
    }
    current = current[key];
  }
  return Array.isArray(current) ? current : [];
}

export function asSlice(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

export function anyAt(value: unknown, ...path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

export function intAt(value: unknown, ...path: string[]): number {
  const found = anyAt(value, ...path);
  return typeof found === "number" ? Math.trunc(found) : 0;
}

export function firstAny(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

export function firstString(...values: string[]): string {
  for (const value of values) {
    if (value) {
      return value.trim();
    }
  }
  return "";
}

export function put(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value === undefined || value === null) {
    return;
  }
  target[key] = value;
}

export function parseJSONOrString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function cloneMap(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value };
}
