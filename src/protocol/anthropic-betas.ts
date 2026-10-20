import { isPlainObject, mapAt, sliceAt, stringAt } from "./json-util.js";

// The server tool types of a Messages body and the beta flag the AI SDK
// anthropic provider sends with each.
const TOOL_BETAS: Record<string, string> = {
  code_execution_20250522: "code-execution-2025-05-22",
  code_execution_20250825: "code-execution-2025-08-25",
  computer_20241022: "computer-use-2024-10-22",
  computer_20250124: "computer-use-2025-01-24",
  computer_20251124: "computer-use-2025-11-24",
  text_editor_20241022: "computer-use-2024-10-22",
  text_editor_20250124: "computer-use-2025-01-24",
  text_editor_20250429: "computer-use-2025-01-24",
  bash_20241022: "computer-use-2024-10-22",
  bash_20250124: "computer-use-2025-01-24",
  memory_20250818: "context-management-2025-06-27",
  web_fetch_20250910: "web-fetch-2025-09-10",
  web_fetch_20260209: "code-execution-web-tools-2026-02-09",
  web_search_20260209: "code-execution-web-tools-2026-02-09",
  advisor_20260301: "advisor-tool-2026-03-01",
};

// The Claude model families older than Claude 4 that the AI SDK treats as
// lacking structured output.
const CLAUDE_3_OR_OLDER =
  /claude-(?:instant(?:-|$)|v?2(?:$|[-.:])|3(?:$|[-.]))/;

// The Claude models the AI SDK treats as supporting structured output.
const STRUCTURED_OUTPUT_MODELS = [
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-fable-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-sonnet-4-5",
  "claude-opus-4-5",
  "claude-haiku-4-5",
  "claude-sonnet-4-1",
];

// v1AnthropicBetas returns the anthropic-beta value the v1 lane sends with a
// Messages body, or "" when no flag applies. The AI SDK derives the flags
// from the request features — body features first, then tools, in the SDK's
// order — and the opencode provider sets no fixed betas of its own.
export function v1AnthropicBetas(body: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    return "";
  }
  if (!isPlainObject(payload)) {
    return "";
  }
  const betas: string[] = [];
  const add = (beta: string): void => {
    if (!betas.includes(beta)) {
      betas.push(beta);
    }
  };

  if (sliceAt(payload, "mcp_servers").length > 0) {
    add("mcp-client-2025-04-04");
  }
  const management = mapAt(payload, "context_management");
  if (Object.keys(management).length > 0) {
    add("context-management-2025-06-27");
    for (const raw of sliceAt(management, "edits")) {
      if (stringAt(raw, "type") === "compact_20260112") {
        add("compact-2026-01-12");
      }
    }
  }
  const container = payload["container"];
  if (isPlainObject(container) && sliceAt(container, "skills").length > 0) {
    add("code-execution-2025-08-25");
    add("skills-2025-10-02");
    add("files-api-2025-04-14");
  }
  if (isPresentJSON(mapAt(payload, "output_config")["task_budget"])) {
    add("task-budgets-2026-03-13");
  }
  if (payload["speed"] === "fast") {
    add("fast-mode-2026-02-01");
  }
  const fallbacks = payload["fallbacks"];
  if (fallbacks === "default") {
    add("server-side-fallback-2026-07-01");
  } else if (Array.isArray(fallbacks) && fallbacks.length > 0) {
    add("server-side-fallback-2026-06-01");
  }
  if (isPresentJSON(mapAt(payload, "thinking")["block_binding"])) {
    add("thinking-binding-controls-2026-08-01");
  }
  const model = stringAt(payload, "model");
  for (const rawTool of sliceAt(payload, "tools")) {
    const tool = isPlainObject(rawTool) ? rawTool : {};
    const type = stringAt(tool, "type");
    if (type === "" || type === "custom") {
      if (anthropicSupportsStructuredOutput(model)) {
        add("structured-outputs-2025-11-13");
      }
      if (
        isPresentJSON(tool["input_examples"]) ||
        isPresentJSON(tool["allowed_callers"])
      ) {
        add("advanced-tool-use-2025-11-20");
      }
      continue;
    }
    const beta = TOOL_BETAS[type];
    if (beta !== undefined) {
      add(beta);
    }
  }
  return betas.join(",");
}

// isPresentJSON reports whether a raw JSON field carries a value.
function isPresentJSON(value: unknown): boolean {
  return value !== undefined && value !== null;
}

// anthropicSupportsStructuredOutput mirrors the AI SDK anthropic provider's
// model capability table: the dated Claude 4.0 releases and Claude 3 and
// older lack structured output, every other Claude model has it, and
// non-Claude models do not.
export function anthropicSupportsStructuredOutput(model: string): boolean {
  for (const supported of STRUCTURED_OUTPUT_MODELS) {
    if (model.includes(supported)) {
      return true;
    }
  }
  if (
    model.includes("claude-sonnet-4-") ||
    model.includes("claude-opus-4-") ||
    model.includes("claude-3-haiku") ||
    CLAUDE_3_OR_OLDER.test(model)
  ) {
    return false;
  }
  return model.includes("claude-");
}
