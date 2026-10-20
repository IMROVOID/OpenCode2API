import { randomBytes, sha256Bytes, toHex } from "./sha256.js";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const CANONICAL_SESSION_PATTERN = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const DESCENDING_TIME_PART_PATTERN = /^[0-9a-f]{9}f[c-f][0-9a-f]$/;
const CLAUDE_CODE_SESSION_PATTERN = /_session_([0-9A-Fa-f-]{36})$/;

export interface RequestIDs {
  session: string;
  request: string;
  message: string;
  project: string;
  parentSession: string;
}

export function isOfficialSessionID(signal: string): boolean {
  return (
    CANONICAL_SESSION_PATTERN.test(signal) &&
    DESCENDING_TIME_PART_PATTERN.test(signal.slice(4, 16))
  );
}

export function canonicalSessionID(signal: string): string {
  if (isOfficialSessionID(signal)) {
    return signal;
  }
  const sum = sha256Bytes(`ses\x00${signal}`);
  const timePart = descendingTimePart(sum.subarray(0, 6));
  const randomPart = base62Fixed(sum.subarray(6, 16), 14);
  return `ses_${timePart}${randomPart}`;
}

function descendingTimePart(hash: Uint8Array): string {
  const current =
    ((BigInt(hash[0] ?? 0) << 28n) |
      (BigInt(hash[1] ?? 0) << 20n) |
      (BigInt(hash[2] ?? 0) << 12n) |
      (BigInt(hash[3] ?? 0) << 4n) |
      (BigInt(hash[4] ?? 0) >> 4n)) <<
    12n;
  const withCounter = current | 1n;
  const inverted = ~withCounter & 0xffffffffffffn;
  return inverted.toString(16).padStart(12, "0");
}

function base62Fixed(bytes: Uint8Array, width: number): string {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  const base = 62n;
  const out = new Array<string>(width);
  for (let i = width - 1; i >= 0; i--) {
    const remainder = value % base;
    value /= base;
    out[i] = BASE62[Number(remainder)] ?? "0";
  }
  return out.join("");
}

function randomBase62(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const byte of bytes) {
    out += BASE62[byte % 62];
  }
  return out;
}

let ascendingLast = 0n;
let ascendingCounter = 0n;

export function ascendingID(prefix: string, now: number = Date.now()): string {
  const ms = BigInt(now);
  if (ms !== ascendingLast) {
    ascendingLast = ms;
    ascendingCounter = 0n;
  }
  ascendingCounter += 1n;
  // The id carries the low 48 bits of the timestamp and the counter.
  const value = BigInt.asUintN(48, (ms << 12n) | ascendingCounter);
  const timePart = value.toString(16).padStart(12, "0");
  return `${prefix}_${timePart}${randomBase62(14)}`;
}

export function randomID(prefix: string, size: number): string {
  return `${prefix}_${toHex(randomBytes(size))}`;
}

// asPrefix returns the id in the target protocol's ID style, prefix plus "_".
// An id that already has that prefix is returned unchanged; otherwise any
// "chatcmpl_", "resp_" or "msg_" prefix is stripped first, so one upstream ID
// maps consistently onto every protocol.
export function asPrefix(id: string, prefix: string): string {
  if (id.startsWith(`${prefix}_`)) {
    return id;
  }
  let trimmed = id;
  for (const current of ["chatcmpl_", "resp_", "msg_"]) {
    if (trimmed.startsWith(current)) {
      trimmed = trimmed.slice(current.length);
    }
  }
  return `${prefix}_${trimmed}`;
}

export function claudeCodeSessionID(userId: string): string {
  if (!userId) {
    return "";
  }
  const match = CLAUDE_CODE_SESSION_PATTERN.exec(userId);
  if (match?.[1]) {
    return match[1];
  }
  try {
    const value: unknown = JSON.parse(userId);
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).session_id === "string"
    ) {
      return (value as Record<string, unknown>).session_id as string;
    }
  } catch {
    // Not a JSON user id.
  }
  return "";
}

export function scopedSessionID(scope: string, signal: string): string {
  if (isOfficialSessionID(signal)) {
    return signal;
  }
  const seeded = scope ? `${scope}\x00${signal}` : signal;
  return canonicalSessionID(seeded);
}
