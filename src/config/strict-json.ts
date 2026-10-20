export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type FieldType =
  | { kind: "string"; values?: string[] }
  | { kind: "number"; integer?: boolean; min?: number; max?: number }
  | { kind: "boolean" }
  | { kind: "string[]" }
  | { kind: "record"; values?: FieldType }
  | { kind: "object"; fields: Record<string, FieldType>; optional?: string[] }
  | { kind: "any" };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function decodeField(
  value: unknown,
  type: FieldType,
  path: string,
): unknown {
  switch (type.kind) {
    case "any":
      return value;
    case "string": {
      if (typeof value !== "string") {
        throw new ConfigError(`${path} must be a string`);
      }
      if (type.values && !type.values.includes(value)) {
        throw new ConfigError(
          `${path} must be one of ${type.values.join(", ")}`,
        );
      }
      return value;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ConfigError(`${path} must be a number`);
      }
      if (type.integer && !Number.isInteger(value)) {
        throw new ConfigError(`${path} must be an integer`);
      }
      if (type.min !== undefined && value < type.min) {
        throw new ConfigError(`${path} must be at least ${type.min}`);
      }
      if (type.max !== undefined && value > type.max) {
        throw new ConfigError(`${path} must be at most ${type.max}`);
      }
      return value;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        throw new ConfigError(`${path} must be a boolean`);
      }
      return value;
    }
    case "string[]": {
      if (!Array.isArray(value)) {
        throw new ConfigError(`${path} must be an array`);
      }
      return value.map((item, index) => {
        if (typeof item !== "string") {
          throw new ConfigError(`${path}[${index}] must be a string`);
        }
        return item;
      });
    }
    case "record": {
      if (!isPlainObject(value)) {
        throw new ConfigError(`${path} must be an object`);
      }
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        result[key] = type.values
          ? decodeField(item, type.values, `${path}.${key}`)
          : item;
      }
      return result;
    }
    case "object": {
      if (!isPlainObject(value)) {
        throw new ConfigError(`${path} must be an object`);
      }
      const optional = new Set(type.optional ?? []);
      for (const key of Object.keys(value)) {
        if (!(key in type.fields) && !optional.has(key)) {
          throw new ConfigError(`${path}.${key} is not a known field`);
        }
      }
      const result: Record<string, unknown> = {};
      for (const [key, fieldType] of Object.entries(type.fields)) {
        if (value[key] === undefined) {
          continue;
        }
        result[key] = decodeField(value[key], fieldType, `${path}.${key}`);
      }
      for (const key of optional) {
        if (value[key] !== undefined) {
          result[key] = value[key];
        }
      }
      return result;
    }
  }
}

export function decodeStrict(
  value: unknown,
  type: FieldType,
  path = "config",
): Record<string, unknown> {
  return decodeField(value, type, path) as Record<string, unknown>;
}
