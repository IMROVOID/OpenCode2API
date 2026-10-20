import { intAt, isPlainObject, stringAt } from "./json-util.js";
import { budgetForEffort } from "./reasoning.js";

const VALID_FORCED_EFFORTS = new Set([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "none",
]);

// validForcedEffort accepts the levels the configuration can force. "none" is
// the escape hatch that removes reasoning again.
export function validForcedEffort(effort: string): boolean {
  return VALID_FORCED_EFFORTS.has(effort);
}

// forcedEffort applies an operator-configured thinking level to a prepared
// upstream body, so a client can be served at a fixed level without the client
// cooperating. A level the client stated explicitly always wins.
export function forcedEffort(
  protocol: string,
  body: Record<string, unknown>,
  effort: string,
): void {
  const level = effort.trim().toLowerCase();
  if (!validForcedEffort(level)) {
    return;
  }
  const disable = level === "none";
  if (protocol === "chat") {
    if (clientEffortExplicit(protocol, body)) {
      return;
    }
    if (disable) {
      delete body["reasoning_effort"];
      return;
    }
    body["reasoning_effort"] = level;
    return;
  }
  if (protocol === "responses") {
    if (clientEffortExplicit(protocol, body)) {
      return;
    }
    if (disable) {
      delete body["reasoning"];
      return;
    }
    const reasoning = body["reasoning"];
    if (isPlainObject(reasoning)) {
      reasoning["effort"] = level;
    } else {
      body["reasoning"] = { effort: level };
    }
    return;
  }
  if (protocol === "anthropic") {
    if (clientEffortExplicit(protocol, body)) {
      return;
    }
    applyAnthropicForcedEffort(body, level, disable);
  }
}

// clientEffortExplicit reports whether an upstream body already carries a
// level in its protocol's native slot, which a forced level must not replace.
export function clientEffortExplicit(
  protocol: string,
  body: Record<string, unknown>,
): boolean {
  if (protocol === "chat") {
    return isNonBlankString(body["reasoning_effort"]);
  }
  if (protocol === "anthropic") {
    const outputConfig = body["output_config"];
    if (isPlainObject(outputConfig) && isNonBlankString(outputConfig["effort"])) {
      return true;
    }
    return isNonBlankString(body["effort"]);
  }
  if (protocol === "responses") {
    const reasoning = body["reasoning"];
    if (isPlainObject(reasoning) && isNonBlankString(reasoning["effort"])) {
      return true;
    }
    return false;
  }
  return false;
}

function isNonBlankString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

// applyAnthropicForcedEffort writes a forced level into an Anthropic body and
// keeps the thinking block and max_tokens consistent with it.
//
// Anthropic represents a level as output_config.effort, but also requires a
// thinking block to carry a budget and requires max_tokens to exceed that
// budget.
export function applyAnthropicForcedEffort(
  body: Record<string, unknown>,
  effort: string,
  disable: boolean,
): void {
  if (disable) {
    delete body["thinking"];
    delete body["output_config"];
    return;
  }
  const outputConfig = body["output_config"];
  if (isPlainObject(outputConfig)) {
    outputConfig["effort"] = effort;
  } else {
    body["output_config"] = { effort };
  }
  const budget = budgetForEffort(effort);
  const thinking = body["thinking"];
  if (isPlainObject(thinking)) {
    thinking["type"] = "enabled";
    thinking["budget_tokens"] = budget;
  } else {
    body["thinking"] = { type: "enabled", budget_tokens: budget };
  }
  // max_tokens must stay strictly greater than the thinking budget, otherwise
  // Anthropic rejects the payload regardless of the requested effort.
  const current = intAt(body, "max_tokens");
  if (current > 0 && current <= budget) {
    body["max_tokens"] = budget + 4096;
  }
}

// requestEnablesReasoning reports whether a body's reasoning_effort,
// reasoning, thinking or effort field asks for reasoning.
export function requestEnablesReasoning(input: Record<string, unknown>): boolean {
  for (const key of ["reasoning_effort", "reasoning", "thinking", "effort"]) {
    const value = input[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string") {
      const mode = value.trim().toLowerCase();
      if (mode !== "" && mode !== "none" && mode !== "disabled") {
        return true;
      }
      continue;
    }
    if (typeof value === "boolean") {
      if (value) {
        return true;
      }
      continue;
    }
    if (isPlainObject(value)) {
      const mode = (stringAt(value, "type") || stringAt(value, "effort"))
        .trim()
        .toLowerCase();
      if (mode === "none" || mode === "disabled") {
        continue;
      }
      return true;
    }
    return true;
  }
  return false;
}
