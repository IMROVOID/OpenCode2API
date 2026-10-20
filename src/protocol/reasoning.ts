import { intAt, isPlainObject, stringAt } from "./json-util.js";

export const TOOL_REASONING_PLACEHOLDER = "tool call";

export const REASONING_VENDOR_HINTS = [
  "moonshot",
  "kimi",
  "deepseek",
  "mimo",
  "xiaomimimo",
];

// isReasoningVendorIdentifier reports whether a model ID or upstream URL names
// one of the reasoning vendors whose endpoints reject tool-call turns without
// reasoning history.
export function isReasoningVendorIdentifier(value: string): boolean {
  const lowered = value.toLowerCase();
  return REASONING_VENDOR_HINTS.some((hint) => lowered.includes(hint));
}

// normalizeEffortValue validates an effort a client stated explicitly. A
// non-blank string passes through verbatim; only "none"/"disabled" mean "no
// reasoning". A blank string or a non-string value reports ok=false.
export function normalizeEffortValue(value: unknown): { value: unknown; ok: boolean } {
  if (typeof value !== "string") {
    return { value: undefined, ok: false };
  }
  const mode = value.trim().toLowerCase();
  if (mode === "none" || mode === "disabled") {
    return { value: undefined, ok: true };
  }
  if (mode === "") {
    return { value: undefined, ok: false };
  }
  return { value, ok: true };
}

// explicitEffort reports the effort a client stated verbatim in a reasoning
// object, and whether the object carried one at all.
export function explicitEffort(
  object: Record<string, unknown>,
): { value: unknown; ok: boolean } {
  for (const key of ["effort", "reasoning_effort"]) {
    if (key in object) {
      const result = normalizeEffortValue(object[key]);
      if (result.ok) {
        return result;
      }
    }
  }
  return { value: undefined, ok: false };
}

// reasoningEffort projects a bridge-level reasoning value onto the OpenAI Chat
// "reasoning_effort" field. An undefined result omits the field.
export function reasoningEffort(value: unknown): unknown {
  if (isPlainObject(value)) {
    const explicit = explicitEffort(value);
    if (explicit.ok) {
      return explicit.value;
    }
    const type = stringAt(value, "type");
    if (type === "disabled") {
      return undefined;
    }
    if (type === "enabled" || type === "adaptive") {
      return effortForThinkingBudget(intAt(value, "budget_tokens"));
    }
    return value["type"];
  }
  const normalized = normalizeEffortValue(value);
  if (normalized.ok) {
    return normalized.value;
  }
  return value;
}

// budgetForEffort synthesizes a thinking budget for a level.
export function budgetForEffort(value: unknown): number {
  const text = typeof value === "string" ? value : "";
  switch (text.trim().toLowerCase()) {
    case "minimal":
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 8192;
    case "xhigh":
      return 16384;
    case "max":
      return 32768;
    default:
      return 4096;
  }
}

// effortForThinkingBudget buckets an Anthropic thinking budget onto an OpenAI
// reasoning level.
export function effortForThinkingBudget(budget: number): string {
  if (budget <= 0) {
    return "high";
  }
  if (budget >= 32768) {
    return "max";
  }
  if (budget >= 16384) {
    return "xhigh";
  }
  if (budget >= 8192) {
    return "high";
  }
  if (budget > 2048) {
    return "medium";
  }
  return "low";
}

// reasoningBudget reports the thinking budget a bridge-level reasoning value
// names, or 0 when the value carries none.
export function reasoningBudget(value: unknown): number {
  if (!isPlainObject(value)) {
    return 0;
  }
  const budget = intAt(value, "budget_tokens");
  if (budget > 0) {
    return budget;
  }
  if (!explicitEffort(value).ok) {
    return 0;
  }
  const stated = value["reasoning_budget_tokens"];
  return typeof stated === "number" ? Math.trunc(stated) : 0;
}

// withReasoningBudget attaches a budget to a bridge-level reasoning value.
export function withReasoningBudget(value: unknown, budget: number): unknown {
  if (budget <= 0) {
    return value;
  }
  if (isPlainObject(value)) {
    return { ...value, budget_tokens: budget };
  }
  return { budget_tokens: budget, effort: value };
}

// anthropicThinking maps a bridge-level reasoning value back onto the
// Anthropic "thinking" block plus the "output_config" that carries the effort
// natively.
export function anthropicThinking(value: unknown): {
  thinking: Record<string, unknown> | undefined;
  outputConfig: Record<string, unknown> | undefined;
} {
  if (value === undefined || value === null) {
    return { thinking: undefined, outputConfig: undefined };
  }
  let budget = 0;
  let subject: unknown = value;
  if (isPlainObject(value)) {
    const kind = stringAt(value, "type");
    budget = intAt(value, "budget_tokens");
    const explicit = explicitEffort(value);
    if (explicit.ok) {
      if (explicit.value === undefined) {
        return { thinking: undefined, outputConfig: undefined };
      }
      return thinkingFor(explicit.value, budget);
    }
    if (kind === "disabled") {
      return { thinking: undefined, outputConfig: undefined };
    }
    if (kind === "enabled" || kind === "adaptive") {
      return thinkingFor(effortForThinkingBudget(budget), budget);
    }
    const level = normalizeEffortValue(value["type"]);
    if (level.ok) {
      if (level.value === undefined) {
        return { thinking: undefined, outputConfig: undefined };
      }
      return thinkingFor(level.value, budget);
    }
    if (budget > 0) {
      return thinkingFor(effortForThinkingBudget(budget), budget);
    }
    subject = value["type"];
  }
  const level = normalizeEffortValue(subject);
  if (!level.ok) {
    if (typeof subject === "number") {
      if (subject <= 0) {
        return { thinking: undefined, outputConfig: undefined };
      }
      return thinkingFor(effortForThinkingBudget(subject), subject);
    }
    return { thinking: undefined, outputConfig: undefined };
  }
  if (level.value === undefined) {
    return { thinking: undefined, outputConfig: undefined };
  }
  return thinkingFor(level.value, budget);
}

function thinkingFor(
  effort: unknown,
  budget: number,
): { thinking: Record<string, unknown>; outputConfig: Record<string, unknown> } {
  const resolved = budget > 0 ? budget : budgetForEffort(effort);
  return {
    thinking: { type: "enabled", budget_tokens: resolved },
    outputConfig: { effort },
  };
}

// responsesReasoning builds the Responses "reasoning" object. An undefined
// result omits the field.
export function responsesReasoning(value: unknown): unknown {
  if (isPlainObject(value)) {
    if (stringAt(value, "type") === "disabled") {
      return undefined;
    }
    const effort = reasoningEffort(value);
    if (effort !== undefined) {
      if (typeof effort === "string") {
        return { effort };
      }
      if (isPlainObject(effort)) {
        return effort;
      }
      return { effort };
    }
    return value;
  }
  if (typeof value === "string") {
    const normalized = normalizeEffortValue(value);
    if (normalized.ok) {
      if (normalized.value === undefined) {
        return undefined;
      }
      return { effort: normalized.value };
    }
    return { effort: value };
  }
  return value;
}
