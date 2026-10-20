import type { Protocol } from "../types/config.js";
import { isPlainObject, sliceAt, stringAt } from "./json-util.js";
import { renameResponseTool } from "./response.js";
import { mergeToolName } from "./stream-parser-shared.js";

// ToolRenameState tracks how one tool call's name was resolved while a stream
// is rewritten. Chat deltas may repeat a growing name prefix or append
// fragments, so a value that is still a prefix of the source name is held back
// until it either completes the match or diverges.
interface ToolRenameState {
  decided: boolean;
  renamed: boolean;
  pending: string;
}

// StreamToolRenamer rewrites the tool names of one protocol's SSE frames,
// keeping per-tool state across frames so a name split over several Chat
// chunks is reassembled before it is matched.
export class StreamToolRenamer {
  private readonly protocol: Protocol;
  private readonly fromName: string;
  private readonly toName: string;
  private readonly tools = new Map<string, ToolRenameState>();

  constructor(protocol: Protocol, fromName: string, toName: string) {
    this.protocol = protocol;
    this.fromName = fromName;
    this.toName = toName;
  }

  // rewriteFrame rewrites one SSE data payload, which is raw JSON text. Frames
  // that cannot carry a tool name are returned untouched, so only a payload
  // that mentions the source name (Anthropic and Responses) or "tool_calls"
  // (Chat) is decoded.
  rewriteFrame(raw: string): string {
    if (this.protocol !== "chat") {
      // Anthropic and Responses streams always carry a complete tool name in
      // a single event, so the stateless object rewrite is exact.
      if (!raw.includes(this.fromName)) {
        return raw;
      }
      return renameResponseTool(raw, this.protocol, this.fromName, this.toName);
    }
    if (!raw.includes('"tool_calls"')) {
      return raw;
    }
    return this.rewriteChatFrame(raw);
  }

  // rewriteChatFrame rewrites the tool names of one Chat chunk. Tool calls are
  // keyed by index, then id, then array position, and each name fragment is
  // folded into the call's state so a name split across chunks is restored as
  // a whole. The frame is returned unchanged when nothing was rewritten.
  private rewriteChatFrame(raw: string): string {
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
    if (!isPlainObject(payload)) {
      return raw;
    }
    let changed = false;
    for (const rawChoice of sliceAt(payload, "choices")) {
      const choice = isPlainObject(rawChoice) ? rawChoice : {};
      for (const container of ["delta", "message"]) {
        const message = isPlainObject(choice[container]) ? choice[container] : {};
        const calls = sliceAt(message, "tool_calls");
        for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
          const rawCall = calls[callIndex];
          const call = isPlainObject(rawCall) ? rawCall : {};
          const fn = call["function"];
          if (!isPlainObject(fn)) {
            continue;
          }
          const state = this.toolState(callKey(call, callIndex));
          const name = fn["name"];
          if (typeof name === "string" && name !== "") {
            if (this.applyNameFragment(state, fn, name)) {
              changed = true;
            }
          }
          if ("arguments" in fn && !state.decided) {
            // Arguments can only start once the name is complete: flush
            // whatever was held back, verbatim.
            if (state.pending !== "") {
              fn["name"] = state.pending;
              changed = true;
            }
            state.decided = true;
          }
        }
      }
    }
    if (!changed) {
      return raw;
    }
    try {
      return JSON.stringify(payload);
    } catch {
      return raw;
    }
  }

  // applyNameFragment folds one name fragment into a tool's rename state and
  // reports whether the frame changed. Once the accumulated name completes the
  // source name, it is replaced by the target name; while it is still a prefix
  // the name is held back; on divergence the accumulated name is written out
  // as is. After a resolved rename, any further fragment is dropped, because
  // it belongs to a longer name the client never declared.
  private applyNameFragment(
    state: ToolRenameState,
    fn: Record<string, unknown>,
    fragment: string,
  ): boolean {
    if (state.decided) {
      if (!state.renamed) {
        return false;
      }
      // A resolved alias accepts no further fragments: any continuation
      // belongs to a longer name the client never declared.
      if ("name" in fn) {
        delete fn["name"];
        return true;
      }
      return false;
    }
    state.pending = mergeToolName(state.pending, fragment);
    if (state.pending === this.fromName) {
      fn["name"] = this.toName;
      state.decided = true;
      state.renamed = true;
      return true;
    }
    if (this.fromName.startsWith(state.pending)) {
      // Still a prefix of the alias: hold the fragment until a later frame
      // either completes the match or diverges.
      delete fn["name"];
      return true;
    }
    fn["name"] = state.pending;
    state.decided = true;
    return true;
  }

  // toolState returns the rename state for a tool key, creating it on first
  // sight.
  private toolState(key: string): ToolRenameState {
    const existing = this.tools.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const state: ToolRenameState = { decided: false, renamed: false, pending: "" };
    this.tools.set(key, state);
    return state;
  }
}

// callKey mirrors the tool key of a Chat call: the call's index, else its id,
// else its array position.
function callKey(call: Record<string, unknown>, index: number): string {
  const raw = call["index"];
  if (raw !== undefined && raw !== null) {
    return String(raw);
  }
  const id = stringAt(call, "id");
  return id !== "" ? id : String(index);
}
