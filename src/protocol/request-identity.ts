import type { IncomingHttpHeaders } from "node:http";
import { sha256Bytes, toHex } from "./sha256.js";
import {
  ascendingID,
  claudeCodeSessionID,
  randomID,
  scopedSessionID,
  type RequestIDs,
} from "./identity.js";
import { firstString, isPlainObject, sliceAt, stringAt } from "./json-util.js";

export type { RequestIDs };

function headerValue(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return typeof value === "string" ? value : "";
}

function conversationSeed(body: Record<string, unknown>): string {
  const prelude: unknown[] = [];
  for (const field of ["system", "instructions"]) {
    if (body[field] !== undefined && body[field] !== null) {
      prelude.push(body[field]);
    }
  }
  const first = firstUserTurn(body, prelude);
  if (first === undefined) {
    return "";
  }
  try {
    return JSON.stringify([...prelude, first]);
  } catch {
    return "";
  }
}

function firstUserTurn(
  body: Record<string, unknown>,
  prelude: unknown[],
): unknown {
  const input = body["input"];
  if (typeof input === "string" && input !== "") {
    return input;
  }
  for (const field of ["messages", "input"]) {
    for (const raw of sliceAt(body, field)) {
      if (!isPlainObject(raw)) {
        continue;
      }
      const role = stringAt(raw, "role");
      if (role === "system" || role === "developer") {
        prelude.push(raw["content"]);
      } else if (role === "user") {
        const content = raw["content"];
        if (content !== undefined && content !== null) {
          return content;
        }
      }
    }
  }
  return undefined;
}

function turnFingerprint(count: number, content: unknown): string {
  let encoded: string;
  try {
    encoded = JSON.stringify(content) ?? "";
  } catch {
    encoded = String(content);
  }
  const sum = sha256Bytes(encoded);
  return `${count}:${toHex(sum.subarray(0, 8))}`;
}

function carriesToolResult(content: unknown): boolean {
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some(
    (block) =>
      isPlainObject(block) && stringAt(block, "type") === "tool_result",
  );
}

function userTurn(body: Record<string, unknown>): string {
  const input = body["input"];
  if (typeof input === "string" && input !== "") {
    return turnFingerprint(1, input);
  }
  let count = 0;
  let last: unknown;
  for (const field of ["messages", "input"]) {
    for (const raw of sliceAt(body, field)) {
      if (!isPlainObject(raw) || stringAt(raw, "role") !== "user") {
        continue;
      }
      if (carriesToolResult(raw["content"])) {
        continue;
      }
      count += 1;
      last = raw["content"];
    }
  }
  if (count === 0) {
    return "";
  }
  return turnFingerprint(count, last);
}

const MESSAGE_TTL_MS = 6 * 60 * 60 * 1000;
const MESSAGE_STORE_LIMIT = 8192;

interface MessageEntry {
  id: string;
  seen: number;
}

class MessageStore {
  private readonly turns = new Map<string, MessageEntry>();
  private readonly latest = new Map<string, MessageEntry>();

  idFor(session: string, turn: string, now: number): string {
    const key = `${session}\x00${turn}`;
    let entry = turn ? this.turns.get(key) : this.latest.get(session);
    if (!entry || now - entry.seen > MESSAGE_TTL_MS) {
      entry = { id: ascendingID("msg", now), seen: now };
    }
    entry.seen = now;
    if (turn) {
      this.turns.set(key, entry);
    }
    this.latest.set(session, entry);
    if (
      this.turns.size > MESSAGE_STORE_LIMIT ||
      this.latest.size > MESSAGE_STORE_LIMIT
    ) {
      this.prune(now);
    }
    return entry.id;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.turns) {
      if (now - entry.seen > MESSAGE_TTL_MS) {
        this.turns.delete(key);
      }
    }
    for (const [key, entry] of this.latest) {
      if (now - entry.seen > MESSAGE_TTL_MS) {
        this.latest.delete(key);
      }
    }
    while (this.turns.size > (MESSAGE_STORE_LIMIT * 3) / 4) {
      const oldest = this.turns.keys().next();
      if (oldest.done) {
        break;
      }
      this.turns.delete(oldest.value);
    }
    while (this.latest.size > (MESSAGE_STORE_LIMIT * 3) / 4) {
      const oldest = this.latest.keys().next();
      if (oldest.done) {
        break;
      }
      this.latest.delete(oldest.value);
    }
  }
}

const userMessages = new MessageStore();

export function userMessageID(
  headers: IncomingHttpHeaders,
  body: Record<string, unknown>,
  session: string,
): string {
  const header = headerValue(headers, "x-opencode-request");
  if (MESSAGE_ID.test(header)) {
    return header;
  }
  return userMessages.idFor(session, userTurn(body), Date.now());
}

const MESSAGE_ID = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

export function deriveRequestIDs(
  headers: IncomingHttpHeaders,
  body: Record<string, unknown>,
  scope: string,
): RequestIDs {
  const signal = firstString(
    headerValue(headers, "x-opencode-session"),
    headerValue(headers, "x-opencode-session-id"),
    headerValue(headers, "x-session-affinity"),
    headerValue(headers, "x-session-id"),
    headerValue(headers, "session_id"),
    headerValue(headers, "conversation-id"),
    headerValue(headers, "conversation_id"),
    stringAt(body, "conversation_id"),
    stringAt(body, "metadata", "session_id"),
    claudeCodeSessionID(stringAt(body, "metadata", "user_id")),
  );

  let effective = signal;
  if (!effective) {
    effective = conversationSeed(body);
  }
  if (!effective) {
    effective = stringAt(body, "previous_response_id");
  }
  if (!effective || effective === "{}") {
    effective = randomID("fallback", 16);
  }

  const session = scopedSessionID(scope, effective);

  let projectSignal = firstString(
    headerValue(headers, "x-opencode-project"),
    stringAt(body, "metadata", "project_id"),
  );
  if (!projectSignal) {
    projectSignal = "opencode2api:default-project";
    if (scope) {
      projectSignal += `:${scope}`;
    }
  }

  const parentSession = firstString(
    headerValue(headers, "x-parent-session-id"),
    stringAt(body, "metadata", "parent_session_id"),
  );

  return {
    session,
    request: randomID("req", 16),
    message: userMessageID(headers, body, session),
    project: projectSignal,
    parentSession,
  };
}
