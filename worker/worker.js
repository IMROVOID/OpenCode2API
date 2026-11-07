// src/protocol/sha256.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
function sha256(input) {
  const h = new Uint32Array([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  const bitLength = input.length * 8;
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const block = new Uint8Array(paddedLength);
  block.set(input);
  block[input.length] = 128;
  const view = new DataView(block.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296), false);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15] ?? 0, 7) ^ (rotr(w[i - 15] ?? 0, 18) ^ (w[i - 15] ?? 0) >>> 3);
      const s1 = rotr(w[i - 2] ?? 0, 17) ^ (rotr(w[i - 2] ?? 0, 19) ^ (w[i - 2] ?? 0) >>> 10);
      w[i] = (w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1 >>> 0;
    }
    let a = h[0] ?? 0;
    let b = h[1] ?? 0;
    let c = h[2] ?? 0;
    let d = h[3] ?? 0;
    let e = h[4] ?? 0;
    let f = h[5] ?? 0;
    let g = h[6] ?? 0;
    let hh = h[7] ?? 0;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const temp1 = hh + S1 + ch + (K[i] ?? 0) + (w[i] ?? 0) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const temp2 = S0 + maj >>> 0;
      hh = g;
      g = f;
      f = e;
      e = d + temp1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2 >>> 0;
    }
    h[0] = (h[0] ?? 0) + a >>> 0;
    h[1] = (h[1] ?? 0) + b >>> 0;
    h[2] = (h[2] ?? 0) + c >>> 0;
    h[3] = (h[3] ?? 0) + d >>> 0;
    h[4] = (h[4] ?? 0) + e >>> 0;
    h[5] = (h[5] ?? 0) + f >>> 0;
    h[6] = (h[6] ?? 0) + g >>> 0;
    h[7] = (h[7] ?? 0) + hh >>> 0;
  }
  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < 8; i += 1) {
    digestView.setUint32(i * 4, h[i] ?? 0, false);
  }
  return digest;
}
function rotr(value, bits) {
  return (value >>> bits | value << 32 - bits) >>> 0;
}
function sha256Bytes(input) {
  return sha256(utf8(input));
}
function toHex(bytes) {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}
function utf8(input) {
  return new TextEncoder().encode(input);
}
function randomBytes(size) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

// src/protocol/identity.ts
var BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
var CANONICAL_SESSION_PATTERN = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
var DESCENDING_TIME_PART_PATTERN = /^[0-9a-f]{9}f[c-f][0-9a-f]$/;
var CLAUDE_CODE_SESSION_PATTERN = /_session_([0-9A-Fa-f-]{36})$/;
function isOfficialSessionID(signal) {
  return CANONICAL_SESSION_PATTERN.test(signal) && DESCENDING_TIME_PART_PATTERN.test(signal.slice(4, 16));
}
function canonicalSessionID(signal) {
  if (isOfficialSessionID(signal)) {
    return signal;
  }
  const sum = sha256Bytes(`ses\0${signal}`);
  const timePart = descendingTimePart(sum.subarray(0, 6));
  const randomPart = base62Fixed(sum.subarray(6, 16), 14);
  return `ses_${timePart}${randomPart}`;
}
function descendingTimePart(hash) {
  const current = (BigInt(hash[0] ?? 0) << 28n | BigInt(hash[1] ?? 0) << 20n | BigInt(hash[2] ?? 0) << 12n | BigInt(hash[3] ?? 0) << 4n | BigInt(hash[4] ?? 0) >> 4n) << 12n;
  const withCounter = current | 1n;
  const inverted = ~withCounter & 0xffffffffffffn;
  return inverted.toString(16).padStart(12, "0");
}
function base62Fixed(bytes, width) {
  let value = 0n;
  for (const byte of bytes) {
    value = value << 8n | BigInt(byte);
  }
  const base = 62n;
  const out = new Array(width);
  for (let i = width - 1; i >= 0; i--) {
    const remainder = value % base;
    value /= base;
    out[i] = BASE62[Number(remainder)] ?? "0";
  }
  return out.join("");
}
function randomBase62(length) {
  const bytes = randomBytes(length);
  let out = "";
  for (const byte of bytes) {
    out += BASE62[byte % 62];
  }
  return out;
}
var ascendingLast = 0n;
var ascendingCounter = 0n;
function ascendingID(prefix, now = Date.now()) {
  const ms = BigInt(now);
  if (ms !== ascendingLast) {
    ascendingLast = ms;
    ascendingCounter = 0n;
  }
  ascendingCounter += 1n;
  const value = BigInt.asUintN(48, ms << 12n | ascendingCounter);
  const timePart = value.toString(16).padStart(12, "0");
  return `${prefix}_${timePart}${randomBase62(14)}`;
}
function mintFreshSessionID(now = Date.now()) {
  const ms = BigInt(now);
  if (ms !== ascendingLast) {
    ascendingLast = ms;
    ascendingCounter = 0n;
  }
  ascendingCounter = ascendingCounter + 1n & 0xfffn;
  if (ascendingCounter === 0n) {
    ascendingCounter = 1n;
  }
  const raw = ms << 12n | ascendingCounter;
  const inverted = ~raw & 0xffffffffffffn;
  const timePart = inverted.toString(16).padStart(12, "0");
  return `ses_${timePart}${randomBase62(14)}`;
}
function randomID(prefix, size) {
  return `${prefix}_${toHex(randomBytes(size))}`;
}
function asPrefix(id, prefix) {
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
function claudeCodeSessionID(userId) {
  if (!userId) {
    return "";
  }
  const match = CLAUDE_CODE_SESSION_PATTERN.exec(userId);
  if (match?.[1]) {
    return match[1];
  }
  try {
    const value = JSON.parse(userId);
    if (typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.session_id === "string") {
      return value.session_id;
    }
  } catch {
  }
  return "";
}
function scopedSessionID(scope, signal) {
  if (isOfficialSessionID(signal)) {
    return signal;
  }
  const seeded = scope ? `${scope}\0${signal}` : signal;
  return canonicalSessionID(seeded);
}

// src/config/defaults.ts
var SOTA_MODELS = [
  "deepseek-v4.1-flash",
  "glm-5.3",
  "grok-4.6",
  "kimi-k3",
  "qwen3.8-max"
];
var V1_BASE = "https://opencode.ai/zen";
var DEFAULT_CONFIG = {
  listen: "127.0.0.1:8080",
  server_keys: [],
  server_key_metadata: {},
  zen_keys: [],
  go_keys: [],
  anonymous: false,
  proxies: [],
  proxyfile: "",
  upstream: {
    zen: V1_BASE,
    go: "https://opencode.ai/zen/go",
    anonymous: "https://opencode.ai/inference"
  },
  retry: {
    max_attempts: 3,
    timeout_seconds: 300
  },
  models: {
    refresh_seconds: 300,
    protocols: {},
    free_only: false
  },
  performance: {
    max_idle_conns: 2048,
    max_idle_conns_per_host: 256,
    max_conns_per_host: 0,
    idle_conn_timeout_seconds: 120,
    connect_timeout_seconds: 5,
    failure_cooldown_seconds: 15,
    attempt_timeout_seconds: 0,
    first_event_timeout_seconds: 0
  },
  logging: {
    level: "info",
    ring_size: 2e3,
    dump_request_bodies: false
  },
  webui: {
    enabled: true,
    listen: "0.0.0.0:8081",
    username: "admin",
    session_ttl_minutes: 720
  },
  prefer: "go",
  reasoning: {
    effort: "",
    effort_by_model: {}
  },
  rotation: {
    sota: { alias: "sota", order: [...SOTA_MODELS] },
    sweet: { alias: "sweet", order: [] },
    first_output_seconds: 30
  }
};

// src/protocol/paths.ts
function protocolPath(protocol) {
  switch (protocol) {
    case "responses":
      return "/v1/responses";
    case "anthropic":
      return "/v1/messages";
    case "systemone":
      return "/v1/systemone";
    default:
      return "/v1/chat/completions";
  }
}

// src/protocol/lanes.ts
var V2_USER_AGENT = "opencode/latest/2.2.5/cli";
var V1_RESPONSES_SDK = "4.0.40";
var V1_ANTHROPIC_SDK = "4.0.46";
var V1_CHAT_SDK = "4.0.23";
function isV1Upstream(baseURL) {
  const normalized = baseURL.trim().toLowerCase().replace(/\/+$/, "");
  return normalized === V1_BASE || normalized.endsWith("/zen");
}
function v1ProviderUtils(protocol) {
  switch (protocol) {
    case "responses":
      return V1_RESPONSES_SDK;
    case "anthropic":
      return V1_ANTHROPIC_SDK;
    default:
      return V1_CHAT_SDK;
  }
}
function v1UserAgent(providerUtils) {
  return `opencode/1.19.3 ai-sdk/provider-utils/${providerUtils} runtime/bun/1.3.14`;
}
function upstreamURL(baseURL, protocol) {
  const trimmed = baseURL.replace(/\/+$/, "");
  if (trimmed.toLowerCase().endsWith("/inference")) {
    const family = protocol === "anthropic" ? "/anthropic" : "/openai";
    return `${trimmed}${family}${protocolPath(protocol)}`;
  }
  return trimmed + protocolPath(protocol);
}

// src/protocol/json-util.ts
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringAt(value, ...path) {
  let current = value;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return "";
    }
    current = current[key];
  }
  return typeof current === "string" ? current : "";
}
function boolAt(value, ...path) {
  let current = value;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return void 0;
    }
    current = current[key];
  }
  return typeof current === "boolean" ? current : void 0;
}
function mapAt(value, ...path) {
  let current = value;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return {};
    }
    current = current[key];
  }
  return isPlainObject(current) ? current : {};
}
function sliceAt(value, ...path) {
  let current = value;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return [];
    }
    current = current[key];
  }
  return Array.isArray(current) ? current : [];
}
function anyAt(value, ...path) {
  let current = value;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return void 0;
    }
    current = current[key];
  }
  return current;
}
function intAt(value, ...path) {
  const found = anyAt(value, ...path);
  return typeof found === "number" ? Math.trunc(found) : 0;
}
function firstAny(...values) {
  for (const value of values) {
    if (value !== void 0 && value !== null) {
      return value;
    }
  }
  return void 0;
}
function firstString(...values) {
  for (const value of values) {
    if (value) {
      return value.trim();
    }
  }
  return "";
}
function put(target, key, value) {
  if (value === void 0 || value === null) {
    return;
  }
  target[key] = value;
}

// src/protocol/request-identity.ts
function headerValue(headers, name) {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return typeof value === "string" ? value : "";
}
function conversationSeed(body) {
  const prelude = [];
  for (const field of ["system", "instructions"]) {
    if (body[field] !== void 0 && body[field] !== null) {
      prelude.push(body[field]);
    }
  }
  const first = firstUserTurn(body, prelude);
  if (first === void 0) {
    return "";
  }
  try {
    return JSON.stringify([...prelude, first]);
  } catch {
    return "";
  }
}
function firstUserTurn(body, prelude) {
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
        if (content !== void 0 && content !== null) {
          return content;
        }
      }
    }
  }
  return void 0;
}
function turnFingerprint(count, content) {
  let encoded;
  try {
    encoded = JSON.stringify(content) ?? "";
  } catch {
    encoded = String(content);
  }
  const sum = sha256Bytes(encoded);
  return `${count}:${toHex(sum.subarray(0, 8))}`;
}
function carriesToolResult(content) {
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some(
    (block) => isPlainObject(block) && stringAt(block, "type") === "tool_result"
  );
}
function userTurn(body) {
  const input = body["input"];
  if (typeof input === "string" && input !== "") {
    return turnFingerprint(1, input);
  }
  let count = 0;
  let last;
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
var MESSAGE_TTL_MS = 6 * 60 * 60 * 1e3;
var MESSAGE_STORE_LIMIT = 8192;
var MessageStore = class {
  turns = /* @__PURE__ */ new Map();
  latest = /* @__PURE__ */ new Map();
  idFor(session, turn, now) {
    const key = `${session}\0${turn}`;
    let entry = turn ? this.turns.get(key) : this.latest.get(session);
    if (!entry || now - entry.seen > MESSAGE_TTL_MS) {
      entry = { id: ascendingID("msg", now), seen: now };
    }
    entry.seen = now;
    if (turn) {
      this.turns.set(key, entry);
    }
    this.latest.set(session, entry);
    if (this.turns.size > MESSAGE_STORE_LIMIT || this.latest.size > MESSAGE_STORE_LIMIT) {
      this.prune(now);
    }
    return entry.id;
  }
  prune(now) {
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
    while (this.turns.size > MESSAGE_STORE_LIMIT * 3 / 4) {
      const oldest = this.turns.keys().next();
      if (oldest.done) {
        break;
      }
      this.turns.delete(oldest.value);
    }
    while (this.latest.size > MESSAGE_STORE_LIMIT * 3 / 4) {
      const oldest = this.latest.keys().next();
      if (oldest.done) {
        break;
      }
      this.latest.delete(oldest.value);
    }
  }
};
var userMessages = new MessageStore();
function userMessageID(headers, body, session) {
  const header = headerValue(headers, "x-opencode-request");
  if (MESSAGE_ID.test(header)) {
    return header;
  }
  return userMessages.idFor(session, userTurn(body), Date.now());
}
var MESSAGE_ID = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
function deriveRequestIDs(headers, body, scope) {
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
    claudeCodeSessionID(stringAt(body, "metadata", "user_id"))
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
    stringAt(body, "metadata", "project_id")
  );
  if (!projectSignal) {
    projectSignal = "opencode2api:default-project";
    if (scope) {
      projectSignal += `:${scope}`;
    }
  }
  const parentSession = firstString(
    headerValue(headers, "x-parent-session-id"),
    stringAt(body, "metadata", "parent_session_id")
  );
  return {
    session,
    request: randomID("req", 16),
    message: userMessageID(headers, body, session),
    project: projectSignal,
    parentSession
  };
}

// src/protocol/error.ts
var ProtocolError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ProtocolError";
  }
};
function buildErrorEnvelope(protocol, status, message, kind) {
  if (protocol === "anthropic") {
    return {
      status,
      body: { type: "error", error: { type: kind, message } }
    };
  }
  return {
    status,
    body: {
      error: { message, type: kind, param: null, code: null }
    }
  };
}

// src/unlimited/lane.ts
var DEFAULT_AAAA_POOL = [
  "2606:4700:10::ac42:ad95",
  "2606:4700:10::ac42:ad96",
  "2606:4700:10::6814:2011"
];
var DOH_URL = "https://1.1.1.1/dns-query?name=opencode.ai&type=AAAA";
var IPV6_HEX_COLON = /^[0-9A-Fa-f:]+$/;
function normalizePrefix64(ipv6) {
  const trimmed = ipv6.trim().toLowerCase();
  if (!trimmed.includes(":") || !IPV6_HEX_COLON.test(trimmed)) {
    return trimmed;
  }
  const expanded = expandIPv6Hextets(trimmed);
  if (expanded.length < 4) {
    return trimmed;
  }
  return expanded.slice(0, 4).map((group) => {
    const parsed = Number.parseInt(group, 16);
    return Number.isNaN(parsed) ? "0" : parsed.toString(16);
  }).join(":");
}
function expandIPv6Hextets(ipv6) {
  if (!ipv6.includes("::")) {
    return ipv6.split(":");
  }
  const [leftRaw = "", rightRaw = ""] = ipv6.split("::");
  const left = leftRaw === "" ? [] : leftRaw.split(":");
  const right = rightRaw === "" ? [] : rightRaw.split(":");
  const missing = Math.max(8 - (left.length + right.length), 0);
  const middle = new Array(missing).fill("0");
  return [...left, ...middle, ...right];
}
async function resolveEdgePool(fetchImpl = fetch, timeoutMs = 3e3) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(DOH_URL, {
      headers: { Accept: "application/dns-json" },
      signal: controller.signal
    });
    if (!response.ok) {
      return [...DEFAULT_AAAA_POOL];
    }
    const payload = await response.json();
    const answers = Array.isArray(payload["Answer"]) ? payload["Answer"] : [];
    const seen = /* @__PURE__ */ new Set();
    for (const entry of answers) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const data = entry["data"];
      if (typeof data === "string" && data.includes(":") && IPV6_HEX_COLON.test(data.trim())) {
        seen.add(data.trim().toLowerCase());
      }
    }
    if (seen.size === 0) {
      return [...DEFAULT_AAAA_POOL];
    }
    return [...seen].sort();
  } catch {
    return [...DEFAULT_AAAA_POOL];
  } finally {
    clearTimeout(timer);
  }
}
function createLaneIdentity(scope, edge = DEFAULT_AAAA_POOL[0]) {
  const seed = `${scope}\0${randomID("lane", 16)}`;
  const projectDigest = sha256Bytes(`opencode-project\0${seed}`);
  const ids = {
    session: mintFreshSessionID(),
    request: randomID("req", 16),
    message: ascendingID("msg"),
    project: toHex(projectDigest.subarray(0, 20)),
    parentSession: ""
  };
  return {
    ids,
    machineId: toHex(randomBytes(16)),
    edge,
    prefix64: normalizePrefix64(edge)
  };
}
function buildEdgeFetchInit(init, edge) {
  if (edge.trim() === "") {
    return { ...init };
  }
  const existingCf = typeof init["cf"] === "object" && init["cf"] !== null ? init["cf"] : {};
  return {
    ...init,
    cf: {
      ...existingCf,
      resolveOverride: edge
    }
  };
}

// src/unlimited/guard.ts
var COOLDOWN_SECONDS = 75;
var MAX_HOP_TRIES = 8;
var BLACKLIST_MAX = 200;
function isQuotaWall(status, bodyText) {
  if (status === 429) {
    return true;
  }
  const lower = bodyText.toLowerCase();
  if (lower.includes("quotaexceeded") || lower.includes("free usage limit reached") || lower.includes("freetiererror") || lower.includes("rate_limit_exceeded")) {
    return true;
  }
  return false;
}
var UnlimitedGuard = class {
  blacklist = [];
  lastHop = 0;
  hops = 0;
  pool;
  activeLane;
  scope;
  constructor(initialPool = DEFAULT_AAAA_POOL, scope = "unlimited") {
    this.scope = scope;
    this.pool = initialPool.length > 0 ? [...initialPool] : [...DEFAULT_AAAA_POOL];
  }
  // current returns the active lane identity and edge, lazily initializing it
  // inside a request handler so Cloudflare Workers global scope never calls
  // crypto.getRandomValues().
  current() {
    if (this.activeLane === void 0) {
      this.activeLane = createLaneIdentity(
        this.scope,
        this.pool[0] ?? DEFAULT_AAAA_POOL[0]
      );
    }
    return this.activeLane;
  }
  // setPool updates the known AAAA edge pool.
  setPool(pool) {
    if (pool.length > 0) {
      this.pool = [...pool];
    }
  }
  // blacklistAdd normalizes an IPv6 address to its /64 prefix and appends it
  // to the lifetime blacklist (capped at BLACKLIST_MAX = 200).
  blacklistAdd(ipv6) {
    const prefix = normalizePrefix64(ipv6);
    if (prefix === "") {
      return;
    }
    const filtered = this.blacklist.filter(
      (entry) => entry !== "" && normalizePrefix64(entry) !== prefix
    );
    const updated = [...filtered, prefix];
    this.blacklist = updated.slice(-BLACKLIST_MAX);
  }
  // isBurnt reports whether an IPv6 address belongs to a blacklisted /64 block.
  isBurnt(ipv6) {
    const prefix = normalizePrefix64(ipv6);
    if (prefix === "") {
      return false;
    }
    return this.blacklist.some(
      (entry) => entry !== "" && normalizePrefix64(entry) === prefix
    );
  }
  // hop blacklists the current edge (when requested), selects a fresh unburned
  // edge (or recycles the oldest block when all are burned), and rotates the
  // device/session/project identity.
  hop(candidatePool, burnCurrent = false, nowSeconds = Math.floor(Date.now() / 1e3)) {
    if (burnCurrent) {
      this.blacklistAdd(this.current().edge);
    }
    const effectivePool = candidatePool !== void 0 && candidatePool.length > 0 ? [...candidatePool] : this.pool;
    let chosen = "";
    let tries = 0;
    while (tries < MAX_HOP_TRIES) {
      const candidate = effectivePool[(this.hops + tries) % effectivePool.length] ?? DEFAULT_AAAA_POOL[0];
      tries += 1;
      if (!this.isBurnt(candidate)) {
        chosen = candidate;
        break;
      }
    }
    if (chosen === "") {
      const oldestPrefix = this.blacklist[0];
      if (oldestPrefix !== void 0) {
        this.blacklist = this.blacklist.slice(1);
        const match = effectivePool.find(
          (edge) => normalizePrefix64(edge) === oldestPrefix
        );
        chosen = match ?? effectivePool[0] ?? DEFAULT_AAAA_POOL[0];
      } else {
        chosen = effectivePool[0] ?? DEFAULT_AAAA_POOL[0];
      }
    }
    this.hops += 1;
    this.lastHop = nowSeconds;
    this.activeLane = createLaneIdentity(this.scope, chosen);
    return this.activeLane;
  }
  // executeWithGuard runs an upstream attempt and automatically hops up to
  // MAX_HOP_TRIES times when a quota wall is encountered.
  async executeWithGuard(attemptFn) {
    let lane = this.current();
    let lastResult = await attemptFn(lane, 1);
    if (!isQuotaWall(lastResult.status, lastResult.bodyPreview)) {
      return lastResult;
    }
    let tries = 0;
    while (tries < MAX_HOP_TRIES) {
      tries += 1;
      lane = this.hop(this.pool, true);
      lastResult = await attemptFn(lane, tries + 1);
      if (!isQuotaWall(lastResult.status, lastResult.bodyPreview)) {
        return lastResult;
      }
    }
    return lastResult;
  }
  // snapshot returns an immutable copy of the guard's state.
  snapshot() {
    const active = this.current();
    return {
      blacklist: [...this.blacklist],
      lastHop: this.lastHop,
      hops: this.hops,
      currentEdge: active.edge,
      currentPrefix64: active.prefix64,
      currentSession: active.ids.session,
      currentMachineId: active.machineId,
      pool: [...this.pool]
    };
  }
};

// src/unlimited/doctor.ts
var IPIFY_V6_URL = "https://api64.ipify.org";
function isCloudflareEgress(ip) {
  const normalized = ip.trim().toLowerCase();
  if (normalized.startsWith("2606:") || normalized.startsWith("2a09:")) {
    return true;
  }
  if (normalized.startsWith("162.159.") || normalized.startsWith("188.114.") || normalized.startsWith("104.") || normalized.startsWith("172.64.") || normalized.startsWith("172.65.") || normalized.startsWith("172.66.") || normalized.startsWith("172.67.")) {
    return true;
  }
  return false;
}
async function probeEgress(fetchImpl = fetch, runtime = "node", timeoutMs = 3e3) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(IPIFY_V6_URL, {
      signal: controller.signal
    });
    if (!response.ok) {
      return fallbackEgress(runtime);
    }
    const ip = (await response.text()).trim();
    if (ip === "") {
      return fallbackEgress(runtime);
    }
    const isCf = runtime === "cloudflare-worker" || isCloudflareEgress(ip);
    return {
      ip,
      prefix64: normalizePrefix64(ip),
      isCloudflare: isCf,
      leakGuardActive: isCf
    };
  } catch {
    return fallbackEgress(runtime);
  } finally {
    clearTimeout(timer);
  }
}
function fallbackEgress(runtime) {
  if (runtime === "cloudflare-worker") {
    return {
      ip: "2606:4700::worker",
      prefix64: "2606:4700:0:0",
      isCloudflare: true,
      leakGuardActive: true
    };
  }
  return {
    ip: "",
    prefix64: "",
    isCloudflare: false,
    leakGuardActive: false
  };
}
async function buildDoctorReport(guard, fetchImpl = fetch, runtime = "node") {
  const egress = await probeEgress(fetchImpl, runtime);
  const snap = guard.snapshot();
  const healthy = (runtime === "cloudflare-worker" || egress.isCloudflare) && snap.pool.length > 0;
  return {
    status: healthy ? "ok" : "degraded",
    runtime,
    egress,
    guard: {
      hops: snap.hops,
      last_hop: snap.lastHop,
      cooldown_seconds: COOLDOWN_SECONDS,
      blacklisted_count: snap.blacklist.length,
      blacklist: snap.blacklist
    },
    lane: {
      current_edge: snap.currentEdge,
      current_prefix64: snap.currentPrefix64,
      current_session: snap.currentSession,
      current_machine_id: snap.currentMachineId,
      pool_size: snap.pool.length,
      pool: snap.pool
    }
  };
}

// src/protocol/block.ts
var ANTHROPIC_REDACTED_THINKING_PLACEHOLDER = "[redacted thinking]";
function emptyBlock(kind) {
  return {
    kind,
    text: "",
    signature: "",
    encrypted: "",
    url: "",
    mediaType: "",
    data: "",
    fileId: "",
    filename: "",
    id: "",
    name: "",
    arguments: void 0,
    argumentsJSON: "",
    callId: "",
    result: void 0,
    isError: false
  };
}
function withText(block, text) {
  return { ...block, text };
}
function withURL(block, url) {
  return { ...block, url };
}
function isBridgeBlockArray(value) {
  return value.every(
    (item) => typeof item === "object" && item !== null && typeof item.kind === "string"
  );
}
function parseJSONOrStringValue(value) {
  if (value === "") {
    return void 0;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// src/protocol/response-usage.ts
function firstNonZero(...values) {
  for (const value of values) {
    if (value !== 0) {
      return value;
    }
  }
  return 0;
}
function decodeOpenAIUsage(usage) {
  const input = firstNonZero(
    intAt(usage, "prompt_tokens"),
    intAt(usage, "input_tokens")
  );
  const output = firstNonZero(
    intAt(usage, "completion_tokens"),
    intAt(usage, "output_tokens")
  );
  let total = intAt(usage, "total_tokens");
  if (total === 0) {
    total = input + output;
  }
  const cached = firstNonZero(
    intAt(usage, "prompt_tokens_details", "cached_tokens"),
    intAt(usage, "input_tokens_details", "cached_tokens")
  );
  const cacheCreation = firstNonZero(
    intAt(usage, "cache_creation_input_tokens"),
    intAt(usage, "prompt_tokens_details", "cache_creation_input_tokens"),
    intAt(usage, "prompt_tokens_details", "cache_write_tokens"),
    intAt(usage, "input_tokens_details", "cache_creation_input_tokens")
  );
  const reasoning = firstNonZero(
    intAt(usage, "completion_tokens_details", "reasoning_tokens"),
    intAt(usage, "output_tokens_details", "reasoning_tokens")
  );
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    cachedInputTokens: cached,
    cacheCreationTokens: cacheCreation,
    reasoningTokens: reasoning
  };
}
function decodeAnthropicUsage(usage) {
  const cached = intAt(usage, "cache_read_input_tokens");
  const cacheCreation = intAt(usage, "cache_creation_input_tokens");
  const output = intAt(usage, "output_tokens");
  const input = intAt(usage, "input_tokens") + cached + cacheCreation;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    cachedInputTokens: cached,
    cacheCreationTokens: cacheCreation,
    reasoningTokens: 0
  };
}
function openAIUsage(usage) {
  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    prompt_tokens_details: { cached_tokens: usage.cachedInputTokens },
    completion_tokens_details: { reasoning_tokens: usage.reasoningTokens }
  };
}
function anthropicUsage(usage) {
  return {
    input_tokens: Math.max(
      usage.inputTokens - usage.cachedInputTokens - usage.cacheCreationTokens,
      0
    ),
    output_tokens: usage.outputTokens,
    cache_creation_input_tokens: usage.cacheCreationTokens,
    cache_read_input_tokens: usage.cachedInputTokens
  };
}
function chatStop(stop) {
  switch (stop) {
    case "tool_use":
    case "tool_calls":
      return "tool_calls";
    case "max_tokens":
    case "length":
      return "length";
    case "content_filter":
    case "error":
      return stop;
    default:
      return "stop";
  }
}
function anthropicStop(stop) {
  switch (stop) {
    case "tool_use":
    case "tool_calls":
      return "tool_use";
    case "max_tokens":
    case "length":
      return "max_tokens";
    case "stop_sequence":
    case "pause_turn":
    case "refusal":
      return stop;
    default:
      return "end_turn";
  }
}
function canonicalChatStop(stop) {
  switch (stop) {
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    case "error":
    case "network_error":
    case "server_error":
      return "error";
    default:
      return "stop";
  }
}
function canonicalAnthropicStop(stop) {
  switch (stop) {
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "length";
    case "stop_sequence":
    case "pause_turn":
    case "refusal":
      return stop;
    case "error":
    case "network_error":
    case "server_error":
      return "error";
    default:
      return "stop";
  }
}
function isToolStop(stop) {
  return stop === "tool_calls" || stop === "tool_use" || stop === "function_call";
}
function usableToolBlocks(tools) {
  return tools.filter((tool) => tool.name.trim() !== "");
}
function canonicalResponsesIncomplete(reason) {
  return reason === "content_filter" ? "content_filter" : "length";
}
function responsesIncompleteReason(stop) {
  return stop === "content_filter" ? "content_filter" : "max_output_tokens";
}

// src/protocol/encode-blocks.ts
function bridgeReasoningText(blocks) {
  if (blocks.length === 0) {
    return { text: "", ok: false };
  }
  let text = "";
  for (const block of blocks) {
    if (block.text !== "") {
      text += block.text;
    } else if (block.encrypted !== "") {
      text += ANTHROPIC_REDACTED_THINKING_PLACEHOLDER;
    }
  }
  return { text, ok: true };
}
function bridgeReasoningSignature(blocks) {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block !== void 0 && block.signature !== "") {
      return block.signature;
    }
  }
  return "";
}
function encodeChatBlocks(blocks) {
  const only = blocks.length === 1 ? blocks[0] : void 0;
  if (only !== void 0 && only.kind === "text") {
    return only.text;
  }
  const parts = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "text":
        parts.push({ type: "text", text: block.text });
        break;
      case "image": {
        let url = block.url;
        if (url === "" && block.data !== "") {
          url = `data:${block.mediaType};base64,${block.data}`;
        }
        parts.push({ type: "image_url", image_url: { url } });
        break;
      }
      case "file": {
        const file = {};
        put(file, "file_id", block.fileId);
        put(file, "file_data", block.data);
        put(file, "filename", block.filename);
        parts.push({ type: "file", file });
        break;
      }
      default:
        break;
    }
  }
  return parts;
}
function encodeAnthropicBlocks(blocks) {
  const parts = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "text":
        parts.push({ type: "text", text: block.text });
        break;
      case "image":
        if (block.url !== "") {
          parts.push({
            type: "image",
            source: { type: "url", url: block.url }
          });
        } else {
          parts.push({
            type: "image",
            source: {
              type: "base64",
              media_type: block.mediaType,
              data: block.data
            }
          });
        }
        break;
      case "file": {
        let source;
        if (block.url !== "") {
          source = { type: "url", url: block.url };
        } else if (block.data !== "") {
          source = {
            type: "base64",
            media_type: firstString(block.mediaType, "application/octet-stream"),
            data: block.data
          };
        }
        if (source) {
          const part = { type: "document", source };
          put(part, "title", block.filename);
          parts.push(part);
        }
        break;
      }
      case "tool_call": {
        const input = block.arguments === void 0 || block.arguments === null ? parseJSONOrStringValue(block.argumentsJSON) : block.arguments;
        parts.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input
        });
        break;
      }
      case "tool_result": {
        let content = block.result;
        if (Array.isArray(content) && isBridgeBlockArray(content)) {
          content = encodeAnthropicBlocks(content);
        }
        parts.push({
          type: "tool_result",
          tool_use_id: block.callId,
          content,
          is_error: block.isError
        });
        break;
      }
      case "reasoning": {
        if (block.encrypted !== "") {
          parts.push({ type: "redacted_thinking", data: block.encrypted });
          break;
        }
        parts.push({
          type: "thinking",
          thinking: block.text,
          signature: block.signature
        });
        break;
      }
      default:
        break;
    }
  }
  return parts;
}
function bridgeArgumentsJSON(block) {
  if (block.argumentsJSON !== "") {
    return block.argumentsJSON;
  }
  if (block.arguments === void 0 || block.arguments === null) {
    return "{}";
  }
  try {
    return JSON.stringify(block.arguments);
  } catch {
    return "{}";
  }
}
function bridgeToolResultContent(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    let text = "";
    let allText = true;
    for (const raw of value) {
      if (!isPlainObject(raw) || raw["type"] !== "text") {
        allText = false;
        break;
      }
      text += typeof raw["text"] === "string" ? raw["text"] : "";
    }
    if (allText) {
      return text;
    }
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
function bridgeBlocksText(blocks) {
  let text = "";
  for (const block of blocks) {
    if (block.kind === "text") {
      text += block.text;
    }
  }
  return text;
}

// src/protocol/encode-shared.ts
function schemaOrDefault(value) {
  if (value === void 0 || value === null) {
    return { type: "object", properties: {} };
  }
  return value;
}
function chatResponseFormat(format) {
  if (!isPlainObject(format)) {
    return void 0;
  }
  switch (stringAt(format, "type")) {
    case "json_object":
      return { type: "json_object" };
    case "json_schema": {
      const nested = format["json_schema"];
      if (isPlainObject(nested)) {
        return { type: "json_schema", json_schema: nested };
      }
      const built = {};
      for (const key of ["name", "description", "schema", "strict"]) {
        if (key in format) {
          built[key] = format[key];
        }
      }
      return Object.keys(built).length === 0 ? void 0 : { type: "json_schema", json_schema: built };
    }
    default:
      return void 0;
  }
}
function responsesTextFormat(format) {
  if (!isPlainObject(format)) {
    return void 0;
  }
  switch (stringAt(format, "type")) {
    case "text":
    case "json_object":
      return format;
    case "json_schema": {
      const nested = format["json_schema"];
      if (!isPlainObject(nested)) {
        return format;
      }
      return { ...nested, type: "json_schema" };
    }
    default:
      return void 0;
  }
}
function encodeChatToolChoice(choice) {
  switch (choice.mode) {
    case "named":
      return { type: "function", function: { name: choice.name } };
    case "auto":
    case "none":
    case "required":
      return choice.mode;
    default:
      return void 0;
  }
}
function encodeResponsesToolChoice(choice) {
  switch (choice.mode) {
    case "named":
      return { type: "function", name: choice.name };
    case "auto":
    case "none":
    case "required":
      return choice.mode;
    default:
      return void 0;
  }
}
function encodeAnthropicToolChoice(choice) {
  switch (choice.mode) {
    case "named":
      return { type: "tool", name: choice.name };
    case "required":
      return { type: "any" };
    case "auto":
      return { type: choice.mode };
    default:
      return void 0;
  }
}
function normalizeResponsesRole(role) {
  return role === "assistant" ? "assistant" : "user";
}
var MIN_RESPONSES_MAX_OUTPUT_TOKENS = 16;
function floorResponsesMaxTokens(value) {
  if (typeof value === "number" && value > 0 && value < MIN_RESPONSES_MAX_OUTPUT_TOKENS) {
    return MIN_RESPONSES_MAX_OUTPUT_TOKENS;
  }
  return value;
}
function encodeResponsesReasoning(block, completed) {
  const id = block.id !== "" ? block.id : randomID("rs", 12);
  const summary = [];
  if (block.text !== "") {
    summary.push({ type: "summary_text", text: block.text });
  }
  const item = { id, type: "reasoning", summary };
  if (block.encrypted !== "") {
    item["encrypted_content"] = block.encrypted;
  }
  if (completed) {
    item["status"] = "completed";
  }
  return item;
}
function encodeResponsesReasoningInput(block) {
  if (block.id === "" && block.encrypted === "") {
    return { item: {}, ok: false };
  }
  return { item: encodeResponsesReasoning(block, false), ok: true };
}

// src/protocol/response-encode.ts
function encodeBridgeResponse(protocol, input) {
  const response = demotePhantomToolStop(input);
  const id = response.id !== "" ? response.id : randomID("resp", 12);
  switch (protocol) {
    case "chat":
      return encodeChatResponse(response, id);
    case "responses":
      return encodeResponsesResponse(response, id);
    case "anthropic":
      return encodeAnthropicResponse(response, id);
    default:
      return {};
  }
}
function demotePhantomToolStop(input) {
  if (!isToolStop(input.stop)) {
    return input;
  }
  const tools = usableToolBlocks(input.tools);
  if (tools.length > 0) {
    return { ...input, tools };
  }
  return { ...input, tools: [], stop: "stop" };
}
function encodeChatResponse(response, id) {
  const message = {
    role: "assistant",
    content: response.text
  };
  const reasoning = bridgeReasoningText(response.reasoning);
  if (reasoning.ok) {
    message["reasoning_content"] = reasoning.text;
  }
  const signature = bridgeReasoningSignature(response.reasoning);
  if (signature !== "") {
    message["reasoning_signature"] = signature;
  }
  if (response.tools.length > 0) {
    const calls = response.tools.map((tool) => ({
      id: tool.id,
      type: "function",
      function: {
        name: tool.name,
        arguments: bridgeArgumentsJSON(tool)
      }
    }));
    message["tool_calls"] = calls;
  }
  return {
    id: asPrefix(id, "chatcmpl"),
    object: "chat.completion",
    created: response.created,
    model: response.model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: chatStop(response.stop)
      }
    ],
    usage: openAIUsage(response.usage)
  };
}
function encodeResponsesResponse(response, id) {
  const output = [];
  for (const reasoning of response.reasoning) {
    output.push(encodeResponsesReasoning(reasoning, true));
  }
  if (response.text !== "") {
    output.push({
      id: randomID("msg", 12),
      type: "message",
      status: "completed",
      role: "assistant",
      content: [
        { type: "output_text", text: response.text, annotations: [] }
      ]
    });
  }
  for (const tool of response.tools) {
    output.push({
      id: randomID("fc", 12),
      type: "function_call",
      status: "completed",
      call_id: tool.id,
      name: tool.name,
      arguments: bridgeArgumentsJSON(tool)
    });
  }
  let status = "completed";
  let incomplete = null;
  if (response.stop === "length" || response.stop === "content_filter") {
    status = "incomplete";
    incomplete = { reason: responsesIncompleteReason(response.stop) };
  } else if (response.stop === "error") {
    status = "failed";
  }
  return {
    id: asPrefix(id, "resp"),
    object: "response",
    created_at: response.created,
    status,
    model: response.model,
    output,
    error: null,
    incomplete_details: incomplete,
    usage: {
      input_tokens: response.usage.inputTokens,
      output_tokens: response.usage.outputTokens,
      total_tokens: response.usage.totalTokens,
      input_tokens_details: { cached_tokens: response.usage.cachedInputTokens },
      output_tokens_details: {
        reasoning_tokens: response.usage.reasoningTokens
      }
    }
  };
}
function encodeAnthropicResponse(response, id) {
  const content = [...encodeAnthropicBlocks(response.reasoning)];
  if (response.text !== "") {
    content.push({ type: "text", text: response.text });
  }
  for (const tool of response.tools) {
    content.push({
      type: "tool_use",
      id: tool.id,
      name: tool.name,
      input: toolInput(tool)
    });
  }
  return {
    id: asPrefix(id, "msg"),
    type: "message",
    role: "assistant",
    model: response.model,
    content,
    stop_reason: anthropicStop(response.stop),
    stop_sequence: null,
    usage: anthropicUsage(response.usage)
  };
}
function toolInput(tool) {
  if (tool.arguments === void 0 || tool.arguments === null) {
    return parseJSONOrStringValue(tool.argumentsJSON);
  }
  return tool.arguments;
}

// src/protocol/sse.ts
var MAX_LINE_BYTES = 16 * 1024 * 1024;
var SSELineTooLongError = class extends Error {
  constructor() {
    super("upstream SSE line exceeds the 16 MiB limit");
  }
};
var SSEReader = class {
  buffer = "";
  decoder = new TextDecoder("utf-8");
  encoder = new TextEncoder();
  eventName = "";
  dataLines = [];
  sawData = false;
  closed = false;
  // push feeds bytes into the reader and returns the records that became
  // complete. Bytes are decoded as a stream so a character split across two
  // pushes is not corrupted.
  push(chunk) {
    if (this.closed) {
      return [];
    }
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }
  // close flushes the decoder and reports that the stream ended. A record that
  // was never terminated by a blank line is dropped, and the caller is told the
  // stream ended unexpectedly.
  close() {
    if (this.closed) {
      return { records: [], truncated: false };
    }
    this.closed = true;
    const tail = this.decoder.decode();
    if (tail !== "") {
      this.buffer += tail;
    }
    const records = this.drain(false);
    return { records, truncated: this.sawData };
  }
  drain(final) {
    const records = [];
    for (; ; ) {
      const boundary = this.nextLineBoundary();
      if (boundary === void 0) {
        break;
      }
      const line = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 1);
      const record = this.consumeLine(line);
      if (record !== void 0) {
        records.push(record);
      }
    }
    if (final && this.buffer !== "") {
      this.buffer = "";
    }
    return records;
  }
  // nextLineBoundary returns the index of the next newline, or undefined when
  // the buffer holds no complete line yet.
  nextLineBoundary() {
    const index = this.buffer.indexOf("\n");
    return index === -1 ? void 0 : index;
  }
  // consumeLine applies one line of the SSE grammar and returns a record when
  // the line closes one.
  consumeLine(raw) {
    if (this.encoder.encode(raw).length > MAX_LINE_BYTES) {
      throw new SSELineTooLongError();
    }
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "") {
      if (!this.sawData) {
        this.eventName = "";
        this.dataLines = [];
        return void 0;
      }
      const record = {
        event: this.eventName,
        data: this.dataLines.join("\n")
      };
      this.eventName = "";
      this.dataLines = [];
      this.sawData = false;
      return record;
    }
    if (line.startsWith(":")) {
      return void 0;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    switch (field) {
      case "event":
        this.eventName = value.trim();
        break;
      case "data":
        this.dataLines.push(value.trim());
        this.sawData = true;
        break;
      default:
        break;
    }
    return void 0;
  }
};

// src/protocol/stream-types.ts
function streamEvent(kind, fields = {}) {
  return {
    kind,
    responseID: "",
    model: "",
    text: "",
    signature: "",
    toolKey: "",
    toolID: "",
    toolName: "",
    stop: "",
    error: "",
    errorType: "",
    encrypted: "",
    usage: void 0,
    ...fields
  };
}
var errStreamUpstreamFailure = new Error(
  "upstream stream failure delivered"
);
var errStreamNormalTermination = new Error(
  "upstream stream terminated normally"
);
var errSSEUnexpectedEOF = new Error("unexpected end of SSE stream");

// src/protocol/stream-parser-shared.ts
function sprint(value) {
  if (value === void 0 || value === null) {
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
function mergeToolName(current, fragment) {
  if (current === "" || fragment === current) {
    return fragment;
  }
  if (fragment.startsWith(current)) {
    return fragment;
  }
  return current + fragment;
}
function responseToolKey(event, item) {
  if (item !== void 0) {
    const id2 = stringAt(item, "id");
    if (id2 !== "") {
      return id2;
    }
  }
  const id = stringAt(event, "item_id");
  if (id !== "") {
    return id;
  }
  return sprint(event["output_index"]);
}
function streamErrorMessage(value, fallback) {
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
function streamErrorType(value) {
  return firstString(
    stringAt(value, "error", "type"),
    stringAt(value, "error", "code"),
    "upstream_error"
  );
}
function isStreamErrorFinish(stop) {
  const normalized = stop.trim().toLowerCase();
  return normalized === "error" || normalized === "network_error" || normalized === "server_error";
}
var ToolTracker = class {
  started = /* @__PURE__ */ new Map();
  ids = /* @__PURE__ */ new Map();
  names = /* @__PURE__ */ new Map();
  order = [];
  argumentKeys = /* @__PURE__ */ new Set();
  reasoningKeys = /* @__PURE__ */ new Set();
  // ensure registers a tool key the first time it is seen and keeps the order
  // in which the calls appeared.
  ensure(key) {
    if (this.started.has(key)) {
      return;
    }
    this.started.set(key, false);
    this.order.push(key);
  }
  setID(key, id) {
    if (id !== "") {
      this.ids.set(key, id);
    }
  }
  setName(key, name) {
    if (name !== "") {
      this.names.set(key, name);
    }
  }
  id(key) {
    return this.ids.get(key) ?? "";
  }
  name(key) {
    return this.names.get(key) ?? "";
  }
  isStarted(key) {
    return this.started.get(key) === true;
  }
  markStarted(key) {
    this.started.set(key, true);
  }
  keys() {
    return [...this.order];
  }
  markArguments(key) {
    this.argumentKeys.add(key);
  }
  hasArguments(key) {
    return this.argumentKeys.has(key);
  }
  markReasoning(key) {
    this.reasoningKeys.add(key);
  }
  hasReasoning(key) {
    return this.reasoningKeys.has(key);
  }
};

// src/protocol/stream-parser-anthropic.ts
var AnthropicStreamParser = class {
  parse(eventName, value) {
    const typeName = stringAt(value, "type") || eventName;
    switch (typeName) {
      case "message_start":
        return this.messageStart(value);
      case "content_block_start":
        return this.contentBlockStart(value);
      case "content_block_delta":
        return this.contentBlockDelta(value);
      case "message_delta":
        return this.messageDelta(value);
      case "message_stop":
        return [streamEvent("done")];
      case "error":
        return [
          streamEvent("error", {
            error: firstString(
              stringAt(value, "error", "message"),
              "upstream Anthropic stream error"
            ),
            errorType: firstString(
              stringAt(value, "error", "type"),
              "upstream_error"
            )
          })
        ];
      default:
        return [];
    }
  }
  messageStart(value) {
    const message = mapAt(value, "message");
    const events = [
      streamEvent("start", {
        responseID: stringAt(message, "id"),
        model: stringAt(message, "model")
      })
    ];
    const usageMap = mapAt(message, "usage");
    if (Object.keys(usageMap).length > 0) {
      events.push(streamEvent("usage", { usage: decodeAnthropicUsage(usageMap) }));
    }
    return events;
  }
  contentBlockStart(value) {
    const block = mapAt(value, "content_block");
    switch (stringAt(block, "type")) {
      case "thinking": {
        const events = [];
        const thinking = stringAt(block, "thinking");
        if (thinking !== "") {
          events.push(streamEvent("reasoning", { text: thinking }));
        }
        const signature = stringAt(block, "signature");
        if (signature !== "") {
          events.push(streamEvent("reasoning_signature", { signature }));
        }
        return events;
      }
      case "redacted_thinking":
        return [
          streamEvent("reasoning", { encrypted: stringAt(block, "data") })
        ];
      case "tool_use":
        return [
          streamEvent("tool_start", {
            toolKey: sprint(value["index"]),
            toolID: stringAt(block, "id"),
            toolName: stringAt(block, "name")
          })
        ];
      case "text": {
        const text = stringAt(block, "text");
        return text === "" ? [] : [streamEvent("text", { text })];
      }
      default:
        return [];
    }
  }
  contentBlockDelta(value) {
    const delta = mapAt(value, "delta");
    switch (stringAt(delta, "type")) {
      case "thinking_delta":
        return [
          streamEvent("reasoning", { text: stringAt(delta, "thinking") })
        ];
      case "signature_delta":
        return [
          streamEvent("reasoning_signature", {
            signature: stringAt(delta, "signature")
          })
        ];
      case "text_delta":
        return [streamEvent("text", { text: stringAt(delta, "text") })];
      case "input_json_delta":
        return [
          streamEvent("tool_delta", {
            toolKey: sprint(value["index"]),
            text: stringAt(delta, "partial_json")
          })
        ];
      default:
        return [];
    }
  }
  messageDelta(value) {
    const events = [];
    const usageMap = mapAt(value, "usage");
    if (Object.keys(usageMap).length > 0) {
      events.push(streamEvent("usage", { usage: decodeAnthropicUsage(usageMap) }));
    }
    const stop = stringAt(value, "delta", "stop_reason");
    if (stop === "") {
      return events;
    }
    if (isStreamErrorFinish(stop)) {
      events.push(
        streamEvent("error", {
          error: "upstream Anthropic stream failed",
          errorType: "upstream_error"
        })
      );
      return events;
    }
    events.push(streamEvent("finish", { stop }));
    return events;
  }
};

// src/protocol/stream-parser-chat.ts
var ChatStreamParser = class {
  tracker = new ToolTracker();
  started = false;
  parse(eventName, value) {
    if (eventName === "error") {
      return [this.errorEvent(value, "upstream Chat stream error")];
    }
    if (value["error"] !== void 0 && value["error"] !== null) {
      return [this.errorEvent(value, "upstream Chat stream error")];
    }
    const events = [];
    if (!this.started) {
      const id = stringAt(value, "id");
      if (id !== "") {
        this.started = true;
        events.push(
          streamEvent("start", {
            responseID: id,
            model: stringAt(value, "model")
          })
        );
      }
    }
    const usageMap = mapAt(value, "usage");
    if (Object.keys(usageMap).length > 0) {
      events.push(streamEvent("usage", { usage: decodeOpenAIUsage(usageMap) }));
    }
    for (const raw of sliceAt(value, "choices")) {
      const choice = mapAt(raw);
      events.push(...this.parseChoice(choice));
    }
    return events;
  }
  parseChoice(choice) {
    const events = [];
    const delta = mapAt(choice, "delta");
    const reasoning = firstString(
      stringAt(delta, "reasoning_content"),
      stringAt(delta, "reasoning")
    );
    if (reasoning !== "") {
      events.push(streamEvent("reasoning", { text: reasoning }));
    }
    const text = stringAt(delta, "content");
    if (text !== "") {
      events.push(streamEvent("text", { text }));
    }
    for (const rawCall of sliceAt(delta, "tool_calls")) {
      events.push(...this.parseToolCall(mapAt(rawCall)));
    }
    const stop = stringAt(choice, "finish_reason");
    if (stop !== "") {
      if (isStreamErrorFinish(stop)) {
        events.push(
          streamEvent("error", {
            error: firstString(
              stringAt(choice, "error", "message"),
              "upstream Chat stream failed"
            ),
            errorType: "upstream_error"
          })
        );
        return events;
      }
      events.push(...this.startPendingTools());
      events.push(streamEvent("finish", { stop }));
    }
    return events;
  }
  parseToolCall(call) {
    const events = [];
    const key = sprint(firstAnyIndex(call));
    const fn = mapAt(call, "function");
    this.tracker.ensure(key);
    this.tracker.setID(key, stringAt(call, "id"));
    const name = stringAt(fn, "name");
    if (name !== "") {
      this.tracker.setName(
        key,
        mergeToolName(this.tracker.name(key), name)
      );
    }
    const args = stringAt(fn, "arguments");
    if (args === "") {
      return events;
    }
    if (!this.tracker.isStarted(key) && this.tracker.name(key) !== "") {
      this.tracker.markStarted(key);
      events.push(this.toolStart(key));
    }
    events.push(
      streamEvent("tool_delta", {
        toolKey: key,
        toolID: this.tracker.id(key),
        toolName: this.tracker.name(key),
        text: args
      })
    );
    return events;
  }
  // startPendingTools announces the calls whose arguments never arrived, so a
  // tool that only carries a name is still delivered to the client.
  startPendingTools() {
    const events = [];
    for (const key of this.tracker.keys()) {
      if (!this.tracker.isStarted(key) && this.tracker.name(key) !== "") {
        this.tracker.markStarted(key);
        events.push(this.toolStart(key));
      }
    }
    return events;
  }
  toolStart(key) {
    return streamEvent("tool_start", {
      toolKey: key,
      toolID: this.tracker.id(key),
      toolName: this.tracker.name(key)
    });
  }
  errorEvent(value, fallback) {
    return streamEvent("error", {
      error: streamErrorMessage(value, fallback),
      errorType: streamErrorType(value)
    });
  }
};
function firstAnyIndex(call) {
  const index = call["index"];
  if (index !== void 0 && index !== null) {
    return index;
  }
  return stringAt(call, "id");
}

// src/protocol/decode-reasoning.ts
function decodeChatReasoning(message) {
  let value;
  if ("reasoning_content" in message) {
    value = message["reasoning_content"];
  } else {
    value = message["reasoning"];
  }
  if (typeof value !== "string") {
    return [];
  }
  const block = emptyBlock("reasoning");
  block.text = value;
  block.signature = stringAt(message, "reasoning_signature");
  return [block];
}
function decodeResponsesReasoning(item) {
  let text = "";
  for (const raw of sliceAt(item, "summary")) {
    text += stringAt(raw, "text");
  }
  const content = item["content"];
  if (content !== void 0 && content !== null) {
    for (const raw of Array.isArray(content) ? content : [content]) {
      text += stringAt(raw, "text");
    }
  }
  const encrypted = stringAt(item, "encrypted_content");
  if (text === "" && encrypted === "") {
    return [];
  }
  const block = emptyBlock("reasoning");
  block.id = stringAt(item, "id");
  block.text = text;
  block.encrypted = encrypted;
  return [block];
}
function anthropicReasoning(input) {
  const stated = firstAny(
    mapAt(input, "output_config")["effort"],
    input["effort"]
  );
  const effort = normalizeEffort(stated);
  if (effort.ok) {
    if (effort.value === void 0) {
      return void 0;
    }
    const thinking = input["thinking"];
    if (isPlainObject(thinking)) {
      return { ...thinking, effort: effort.value };
    }
    return effort.value;
  }
  return input["thinking"];
}
function normalizeEffort(value) {
  if (typeof value !== "string") {
    return { value: void 0, ok: false };
  }
  const mode = value.trim().toLowerCase();
  if (mode === "none" || mode === "disabled") {
    return { value: void 0, ok: true };
  }
  if (mode === "") {
    return { value: void 0, ok: false };
  }
  return { value, ok: true };
}

// src/protocol/stream-parser-responses.ts
var ResponsesStreamParser = class {
  tracker = new ToolTracker();
  parse(eventName, value) {
    const typeName = stringAt(value, "type") || eventName;
    switch (typeName) {
      case "error":
        return [
          streamEvent("error", {
            error: streamErrorMessage(
              value,
              "upstream Responses stream error"
            ),
            errorType: streamErrorType(value)
          })
        ];
      case "response.created": {
        const response = mapAt(value, "response");
        return [
          streamEvent("start", {
            responseID: stringAt(response, "id"),
            model: stringAt(response, "model")
          })
        ];
      }
      case "response.output_text.delta":
        return [streamEvent("text", { text: stringAt(value, "delta") })];
      case "response.reasoning_summary_text.delta": {
        this.tracker.markReasoning(responseToolKey(value, void 0));
        return [streamEvent("reasoning", { text: stringAt(value, "delta") })];
      }
      case "response.output_item.added":
        return this.outputItemAdded(value);
      case "response.function_call_arguments.delta":
        return this.argumentsDelta(value);
      case "response.function_call_arguments.done":
        return this.argumentsDone(value);
      case "response.output_item.done":
        return this.outputItemDone(value);
      case "response.completed":
      case "response.incomplete":
      case "response.failed":
      case "response.done":
        return this.terminated(typeName, value);
      default:
        return [];
    }
  }
  outputItemAdded(value) {
    const item = mapAt(value, "item");
    if (stringAt(item, "type") !== "function_call") {
      return [];
    }
    const key = responseToolKey(value, item);
    this.tracker.ensure(key);
    this.tracker.setID(key, stringAt(item, "call_id"));
    this.tracker.setName(key, stringAt(item, "name"));
    if (this.tracker.name(key) === "") {
      return [];
    }
    this.tracker.markStarted(key);
    return [this.toolStart(key)];
  }
  argumentsDelta(value) {
    const key = responseToolKey(value, void 0);
    this.tracker.markArguments(key);
    return [
      streamEvent("tool_delta", {
        toolKey: key,
        toolID: this.tracker.id(key),
        toolName: this.tracker.name(key),
        text: stringAt(value, "delta")
      })
    ];
  }
  argumentsDone(value) {
    const key = responseToolKey(value, void 0);
    if (this.tracker.hasArguments(key)) {
      return [];
    }
    this.tracker.markArguments(key);
    return [
      streamEvent("tool_delta", {
        toolKey: key,
        toolID: this.tracker.id(key),
        toolName: this.tracker.name(key),
        text: stringAt(value, "arguments")
      })
    ];
  }
  outputItemDone(value) {
    const item = mapAt(value, "item");
    const type = stringAt(item, "type");
    if (type === "reasoning") {
      return this.reasoningDone(value, item);
    }
    if (type !== "function_call") {
      return [];
    }
    const key = responseToolKey(value, item);
    this.tracker.ensure(key);
    this.tracker.setID(key, stringAt(item, "call_id"));
    this.tracker.setName(key, stringAt(item, "name"));
    const events = [];
    if (!this.tracker.isStarted(key)) {
      this.tracker.markStarted(key);
      events.push(this.toolStart(key));
    }
    if (!this.tracker.hasArguments(key)) {
      const args = stringAt(item, "arguments");
      if (args !== "") {
        events.push(streamEvent("tool_delta", { toolKey: key, text: args }));
      }
    }
    return events;
  }
  reasoningDone(value, item) {
    const key = responseToolKey(value, item);
    if (this.tracker.hasReasoning(key)) {
      return [];
    }
    const first = decodeResponsesReasoning(item)[0];
    if (first === void 0) {
      return [];
    }
    return [
      streamEvent("reasoning", {
        text: first.text,
        encrypted: first.encrypted
      })
    ];
  }
  terminated(typeName, value) {
    const response = mapAt(value, "response");
    const usageMap = mapAt(response, "usage");
    if (typeName === "response.failed" || stringAt(response, "status") === "failed") {
      const errorEvent = streamEvent("error", {
        error: firstString(
          stringAt(response, "error", "message"),
          stringAt(value, "error", "message"),
          "upstream Responses request failed"
        ),
        errorType: firstString(
          stringAt(response, "error", "code"),
          "upstream_error"
        )
      });
      if (Object.keys(usageMap).length === 0) {
        return [errorEvent];
      }
      return [
        streamEvent("usage", { usage: decodeOpenAIUsage(usageMap) }),
        errorEvent
      ];
    }
    const stop = typeName === "response.incomplete" ? canonicalResponsesIncomplete(
      stringAt(response, "incomplete_details", "reason")
    ) : this.completedStop(response);
    const events = [];
    if (Object.keys(usageMap).length > 0) {
      events.push(streamEvent("usage", { usage: decodeOpenAIUsage(usageMap) }));
    }
    events.push(streamEvent("finish", { stop }));
    events.push(streamEvent("done"));
    return events;
  }
  // completedStop decides how a finished Responses turn is reported. The
  // completed event carries no stop reason, so the function_call items in its
  // output — or the tool calls seen earlier — are the only signal that the
  // turn ended waiting for tool results.
  completedStop(response) {
    for (const raw of sliceAt(response, "output")) {
      if (stringAt(mapAt(raw), "type") === "function_call") {
        return "tool_calls";
      }
    }
    return this.tracker.keys().length > 0 ? "tool_calls" : "stop";
  }
  toolStart(key) {
    return streamEvent("tool_start", {
      toolKey: key,
      toolID: this.tracker.id(key),
      toolName: this.tracker.name(key)
    });
  }
};

// src/protocol/stream-parser.ts
var StreamParser = class {
  protocol;
  parser;
  constructor(protocol) {
    this.protocol = protocol;
    this.parser = createParser(protocol);
  }
  // parse turns one SSE event into zero or more bridge events. A "[DONE]"
  // terminator is only valid on Chat, which uses it to end the stream.
  parse(eventName, data) {
    if (data === "[DONE]") {
      if (this.protocol !== "chat") {
        throw new Error(
          `unexpected [DONE] terminator for ${this.protocol} stream`
        );
      }
      return [streamEvent("done")];
    }
    let value;
    try {
      value = JSON.parse(data);
    } catch (error) {
      throw new Error(`invalid upstream SSE JSON: ${errorMessage(error)}`);
    }
    return this.parser.parse(eventName, mapAt(value));
  }
};
function createParser(protocol) {
  switch (protocol) {
    case "chat":
      return new ChatStreamParser();
    case "anthropic":
      return new AnthropicStreamParser();
    case "responses":
      return new ResponsesStreamParser();
    default:
      throw new Error(`unsupported stream protocol "${protocol}"`);
  }
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/protocol/stream-writer.ts
function mergeBridgeUsage(destination, source) {
  const merged = {
    inputTokens: source.inputTokens !== 0 ? source.inputTokens : destination.inputTokens,
    outputTokens: source.outputTokens !== 0 ? source.outputTokens : destination.outputTokens,
    totalTokens: source.totalTokens !== 0 ? Math.max(destination.totalTokens, source.totalTokens) : destination.totalTokens,
    cachedInputTokens: source.cachedInputTokens !== 0 ? source.cachedInputTokens : destination.cachedInputTokens,
    cacheCreationTokens: source.cacheCreationTokens !== 0 ? source.cacheCreationTokens : destination.cacheCreationTokens,
    reasoningTokens: source.reasoningTokens !== 0 ? source.reasoningTokens : destination.reasoningTokens
  };
  merged.totalTokens = Math.max(
    merged.totalTokens,
    merged.inputTokens + merged.outputTokens
  );
  return merged;
}

// src/protocol/collapse.ts
async function collapseStream(source, protocol, model) {
  const parser = new StreamParser(protocol);
  const accumulator = new CollapseAccumulator(model);
  const reader = new SSEReader();
  let terminated = false;
  let streamError;
  for await (const chunk of source) {
    for (const record of reader.push(chunk)) {
      const outcome = consumeRecord(
        parser,
        accumulator,
        record.event,
        record.data
      );
      if (outcome.stop) {
        terminated = true;
        break;
      }
      if (outcome.error !== void 0) {
        streamError = outcome.error;
        break;
      }
    }
    if (terminated || streamError !== void 0) {
      break;
    }
  }
  if (streamError !== void 0) {
    throw streamError;
  }
  if (!terminated) {
    reader.close();
    throw errSSEUnexpectedEOF;
  }
  const response = accumulator.response();
  return JSON.stringify(encodeBridgeResponse(protocol, response));
}
function consumeRecord(parser, accumulator, eventName, data) {
  let events;
  try {
    events = parser.parse(eventName, data);
  } catch (error) {
    return { stop: false, error: asError(error) };
  }
  for (const event of events) {
    if (event.kind === "done") {
      return { stop: true, error: void 0 };
    }
    if (event.kind === "error") {
      const message = event.error !== "" ? event.error : "upstream stream failed";
      return { stop: false, error: new Error(message) };
    }
    accumulator.apply(event);
  }
  return { stop: false, error: void 0 };
}
function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}
var CollapseAccumulator = class {
  text = "";
  reasoning = [];
  tools = [];
  toolIndex = /* @__PURE__ */ new Map();
  openReasoning;
  id = "";
  model;
  stop = "";
  usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0
  };
  created;
  constructor(model) {
    this.model = model;
    this.created = Math.floor(Date.now() / 1e3);
  }
  // apply folds one stream event into the response. Reasoning text and
  // signatures accumulate into the open reasoning block, while encrypted
  // reasoning is stored in a block of its own that is closed at once.
  apply(event) {
    switch (event.kind) {
      case "start":
        if (event.responseID !== "") {
          this.id = event.responseID;
        }
        if (event.model !== "") {
          this.model = event.model;
        }
        return;
      case "text":
        this.text += event.text;
        return;
      case "reasoning": {
        if (event.text === "" && event.encrypted === "" && event.signature === "") {
          return;
        }
        const block = this.openReasoningBlock();
        block.text += event.text;
        if (event.encrypted !== "") {
          this.closeReasoning();
          const encrypted = this.openReasoningBlock();
          encrypted.encrypted += event.encrypted;
          this.closeReasoning();
        }
        return;
      }
      case "reasoning_signature": {
        const block = this.openReasoningBlock();
        block.signature += event.signature;
        return;
      }
      case "tool_start":
        this.toolBlock(event.toolKey, event.toolID, event.toolName);
        return;
      case "tool_delta": {
        const block = this.toolBlock(event.toolKey, event.toolID, event.toolName);
        block.argumentsJSON += event.text;
        return;
      }
      case "usage":
        if (event.usage !== void 0) {
          this.usage = mergeBridgeUsage(this.usage, event.usage);
        }
        return;
      case "finish":
        this.stop = event.stop;
        return;
      default:
        return;
    }
  }
  // openReasoningBlock returns the reasoning block that deltas accumulate
  // into, appending a new one when none is open: before the first reasoning
  // event, and after an encrypted event closed the previous block.
  openReasoningBlock() {
    if (this.openReasoning === void 0) {
      this.reasoning.push(emptyBlock("reasoning"));
      this.openReasoning = this.reasoning.length - 1;
    }
    const block = this.reasoning[this.openReasoning];
    if (block === void 0) {
      throw new Error("collapse accumulator lost its reasoning block");
    }
    return block;
  }
  // closeReasoning closes the open reasoning block, so the next reasoning
  // delta starts a new one.
  closeReasoning() {
    this.openReasoning = void 0;
  }
  // toolBlock returns the tool call for a stream tool key, appending it on
  // first sight and filling in an ID or name that earlier events lacked.
  toolBlock(key, id, name) {
    const index = this.toolIndex.get(key);
    if (index !== void 0) {
      const block2 = this.tools[index];
      if (block2 === void 0) {
        throw new Error("collapse accumulator lost its tool block");
      }
      if (block2.id === "") {
        block2.id = id;
      }
      if (block2.name === "") {
        block2.name = name;
      }
      return block2;
    }
    const block = emptyBlock("tool_call");
    block.id = id;
    block.name = name;
    this.tools.push(block);
    this.toolIndex.set(key, this.tools.length - 1);
    return block;
  }
  response() {
    return {
      id: this.id,
      model: this.model,
      text: this.text,
      reasoning: [...this.reasoning],
      tools: [...this.tools],
      stop: this.stop,
      error: "",
      usage: this.usage,
      created: this.created
    };
  }
};

// src/protocol/decode-blocks.ts
function decodeOpenAIBlocks(value) {
  if (typeof value === "string") {
    return value === "" ? [] : [withText(emptyBlock("text"), value)];
  }
  if (isPlainObject(value)) {
    return decodeOpenAIBlocks([value]);
  }
  if (Array.isArray(value)) {
    const blocks = [];
    for (const raw of value) {
      if (!isPlainObject(raw)) {
        throw new ProtocolError("OpenAI content block must be an object");
      }
      const type = stringAt(raw, "type");
      switch (type) {
        case "text":
        case "input_text":
        case "output_text":
          blocks.push(withText(emptyBlock("text"), stringAt(raw, "text")));
          break;
        case "image_url":
          blocks.push(
            withURL(
              emptyBlock("image"),
              firstString(
                stringAt(raw, "image_url", "url"),
                stringAt(raw, "image_url")
              )
            )
          );
          break;
        case "input_image":
          blocks.push(withURL(emptyBlock("image"), stringAt(raw, "image_url")));
          break;
        case "file":
        case "input_file": {
          const file = mapAt(raw, "file");
          const block = emptyBlock("file");
          block.fileId = firstString(
            stringAt(raw, "file_id"),
            stringAt(file, "file_id")
          );
          block.filename = firstString(
            stringAt(raw, "filename"),
            stringAt(file, "filename")
          );
          block.mediaType = firstString(
            stringAt(raw, "media_type"),
            stringAt(file, "media_type")
          );
          block.data = firstString(
            stringAt(raw, "file_data"),
            stringAt(file, "file_data")
          );
          blocks.push(block);
          break;
        }
        default:
          throw new ProtocolError(
            `unsupported OpenAI content block type ${JSON.stringify(type)}`
          );
      }
    }
    return blocks;
  }
  if (value === void 0 || value === null) {
    return [];
  }
  throw new ProtocolError("unsupported OpenAI content value");
}
function decodeAnthropicBlocks(value) {
  if (typeof value === "string") {
    return value === "" ? [] : [withText(emptyBlock("text"), value)];
  }
  const blocks = [];
  for (const raw of asBlocks(value)) {
    if (!isPlainObject(raw)) {
      throw new ProtocolError("Anthropic content block must be an object");
    }
    const type = stringAt(raw, "type");
    switch (type) {
      case "thinking": {
        const block = emptyBlock("reasoning");
        block.text = stringAt(raw, "thinking");
        block.signature = stringAt(raw, "signature");
        blocks.push(block);
        break;
      }
      case "redacted_thinking": {
        const block = emptyBlock("reasoning");
        block.encrypted = stringAt(raw, "data");
        blocks.push(block);
        break;
      }
      case "text":
        blocks.push(withText(emptyBlock("text"), stringAt(raw, "text")));
        break;
      case "image": {
        const source = mapAt(raw, "source");
        const block = emptyBlock("image");
        if (stringAt(source, "type") === "url") {
          block.url = stringAt(source, "url");
        } else {
          block.mediaType = stringAt(source, "media_type");
          block.data = stringAt(source, "data");
        }
        blocks.push(block);
        break;
      }
      case "document": {
        const source = mapAt(raw, "source");
        if (stringAt(source, "type") === "text") {
          blocks.push(
            withText(
              emptyBlock("text"),
              firstString(stringAt(source, "data"), stringAt(source, "text"))
            )
          );
          break;
        }
        const block = emptyBlock("file");
        block.url = stringAt(source, "url");
        block.mediaType = stringAt(source, "media_type");
        block.data = firstString(
          stringAt(source, "data"),
          stringAt(source, "text")
        );
        block.filename = stringAt(raw, "title");
        blocks.push(block);
        break;
      }
      case "tool_use": {
        const block = emptyBlock("tool_call");
        block.id = stringAt(raw, "id");
        block.name = stringAt(raw, "name");
        block.arguments = raw["input"];
        blocks.push(block);
        break;
      }
      case "tool_result": {
        const block = emptyBlock("tool_result");
        block.callId = stringAt(raw, "tool_use_id");
        block.result = raw["content"];
        block.isError = boolAt(raw, "is_error") ?? false;
        blocks.push(block);
        break;
      }
      default:
        throw new ProtocolError(
          `unsupported Anthropic content block type ${JSON.stringify(type)}`
        );
    }
  }
  return blocks;
}
function asBlocks(value) {
  if (value === void 0 || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

// src/protocol/tool-images.ts
function decodeToolImages(from, value) {
  if (!Array.isArray(value)) {
    return value;
  }
  const anthropic = from === "anthropic";
  const imageType = anthropic ? "image" : "input_image";
  const textType = anthropic ? "text" : "input_text";
  const hasImage = value.some(
    (part) => isPlainObject(part) && part["type"] === imageType
  );
  if (!hasImage) {
    return value;
  }
  for (let i = 0; i < value.length; i++) {
    const part = value[i];
    if (!isPlainObject(part)) {
      throw new ProtocolError(`content[${i}] must be an object`);
    }
    const type = part["type"];
    if (type === textType) {
      if (typeof part["text"] !== "string") {
        throw new ProtocolError(`content[${i}] requires text`);
      }
      continue;
    }
    if (type === imageType) {
      if (anthropic) {
        if (!validAnthropicImageSource(mapAt(part, "source"))) {
          throw new ProtocolError(
            `content[${i}] has an unsupported or conflicting image source`
          );
        }
      } else if (stringAt(part, "image_url") === "" || part["file_id"] !== void 0) {
        throw new ProtocolError(
          `content[${i}] requires an image URL without a file reference`
        );
      }
      continue;
    }
    throw new ProtocolError(
      `content[${i}] contains an unsupported block alongside tool images`
    );
  }
  if (anthropic) {
    return decodeAnthropicBlocks(value);
  }
  const blocks = decodeOpenAIBlocks(value);
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block === void 0 || block.kind !== "image" || !block.url.startsWith("data:")) {
      continue;
    }
    const parsed = splitDataURI(block.url);
    if (!parsed) {
      throw new ProtocolError(`content[${i}] has an invalid image data URI`);
    }
    block.url = "";
    block.mediaType = parsed.mediaType;
    block.data = parsed.data;
  }
  return blocks;
}
function validAnthropicImageSource(source) {
  const type = stringAt(source, "type");
  if (type === "url") {
    return stringAt(source, "url") !== "" && source["data"] === void 0 && source["file_id"] === void 0;
  }
  if (type === "base64") {
    return stringAt(source, "data") !== "" && stringAt(source, "media_type").startsWith("image/") && source["url"] === void 0 && source["file_id"] === void 0;
  }
  return false;
}
function splitDataURI(url) {
  const rest = url.slice("data:".length);
  const comma = rest.indexOf(",");
  if (comma < 0) {
    return void 0;
  }
  const header = rest.slice(0, comma);
  const data = rest.slice(comma + 1);
  if (!header.endsWith(";base64")) {
    return void 0;
  }
  const mediaType = header.slice(0, header.length - ";base64".length);
  if (!mediaType.startsWith("image/") || data === "") {
    return void 0;
  }
  return { mediaType, data };
}
function chatToolImages(result) {
  if (!Array.isArray(result.result) || !isBridgeBlockList(result.result)) {
    return { text: bridgeToolResultContent(result.result), images: [] };
  }
  let text = "";
  const images = [];
  let n = 0;
  for (const part of result.result) {
    if (part.kind === "text") {
      text += part.text;
      continue;
    }
    n++;
    const marker = `[tool_image call_id=${JSON.stringify(result.callId)} index=${n}]`;
    text += `
${marker}
`;
    images.push({ ...emptyBlock("text"), text: marker }, part);
  }
  return { text, images };
}
function responsesToolContent(value) {
  if (!Array.isArray(value) || !isBridgeBlockList(value)) {
    return bridgeToolResultContent(value);
  }
  const content = [];
  for (const part of value) {
    if (part.kind === "text") {
      content.push({ type: "input_text", text: part.text });
      continue;
    }
    let url = part.url;
    if (url === "") {
      url = `data:${part.mediaType};base64,${part.data}`;
    }
    content.push({ type: "input_image", image_url: url });
  }
  return content;
}
function isBridgeBlockList(value) {
  return value.every(
    (item) => typeof item === "object" && item !== null && typeof item.kind === "string"
  );
}

// src/protocol/decode-request-shared.ts
function appendBridgeBlock(messages, role, block) {
  const last = messages[messages.length - 1];
  if (last && last.role === role && bridgeBlocksOnlyTools(last.blocks)) {
    last.blocks = [...last.blocks, block];
    return;
  }
  messages.push({ role, blocks: [block] });
}
function bridgeBlocksOnlyTools(blocks) {
  if (blocks.length === 0) {
    return false;
  }
  return blocks.every(
    (block) => block.kind === "tool_call" || block.kind === "tool_result"
  );
}
function emptyToolChoice() {
  return { mode: "", name: "" };
}
function decodeChatToolChoice(value) {
  if (typeof value === "string") {
    return { mode: value, name: "" };
  }
  if (isPlainObject(value) && stringAt(value, "type") === "function") {
    return { mode: "named", name: stringAt(value, "function", "name") };
  }
  return emptyToolChoice();
}
function decodeResponsesToolChoice(value) {
  if (typeof value === "string") {
    return { mode: value, name: "" };
  }
  if (isPlainObject(value) && stringAt(value, "type") === "function") {
    return { mode: "named", name: stringAt(value, "name") };
  }
  return emptyToolChoice();
}
function decodeAnthropicToolChoice(value) {
  if (typeof value === "string") {
    const mode = value === "required" ? "any" : value;
    return decodeAnthropicToolChoice({ type: mode });
  }
  if (!isPlainObject(value)) {
    return emptyToolChoice();
  }
  switch (stringAt(value, "type")) {
    case "auto":
      return { mode: "auto", name: "" };
    case "none":
      return { mode: "none", name: "" };
    case "any":
      return { mode: "required", name: "" };
    case "tool":
      return { mode: "named", name: stringAt(value, "name") };
    default:
      return emptyToolChoice();
  }
}

// src/protocol/reasoning.ts
function normalizeEffortValue(value) {
  if (typeof value !== "string") {
    return { value: void 0, ok: false };
  }
  const mode = value.trim().toLowerCase();
  if (mode === "none" || mode === "disabled") {
    return { value: void 0, ok: true };
  }
  if (mode === "") {
    return { value: void 0, ok: false };
  }
  return { value, ok: true };
}
function explicitEffort(object) {
  for (const key of ["effort", "reasoning_effort"]) {
    if (key in object) {
      const result = normalizeEffortValue(object[key]);
      if (result.ok) {
        return result;
      }
    }
  }
  return { value: void 0, ok: false };
}
function reasoningEffort(value) {
  if (isPlainObject(value)) {
    const explicit = explicitEffort(value);
    if (explicit.ok) {
      return explicit.value;
    }
    const type = stringAt(value, "type");
    if (type === "disabled") {
      return void 0;
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
function budgetForEffort(value) {
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
function effortForThinkingBudget(budget) {
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
function reasoningBudget(value) {
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
function withReasoningBudget(value, budget) {
  if (budget <= 0) {
    return value;
  }
  if (isPlainObject(value)) {
    return { ...value, budget_tokens: budget };
  }
  return { budget_tokens: budget, effort: value };
}
function anthropicThinking(value) {
  if (value === void 0 || value === null) {
    return { thinking: void 0, outputConfig: void 0 };
  }
  let budget = 0;
  let subject = value;
  if (isPlainObject(value)) {
    const kind = stringAt(value, "type");
    budget = intAt(value, "budget_tokens");
    const explicit = explicitEffort(value);
    if (explicit.ok) {
      if (explicit.value === void 0) {
        return { thinking: void 0, outputConfig: void 0 };
      }
      return thinkingFor(explicit.value, budget);
    }
    if (kind === "disabled") {
      return { thinking: void 0, outputConfig: void 0 };
    }
    if (kind === "enabled" || kind === "adaptive") {
      return thinkingFor(effortForThinkingBudget(budget), budget);
    }
    const level2 = normalizeEffortValue(value["type"]);
    if (level2.ok) {
      if (level2.value === void 0) {
        return { thinking: void 0, outputConfig: void 0 };
      }
      return thinkingFor(level2.value, budget);
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
        return { thinking: void 0, outputConfig: void 0 };
      }
      return thinkingFor(effortForThinkingBudget(subject), subject);
    }
    return { thinking: void 0, outputConfig: void 0 };
  }
  if (level.value === void 0) {
    return { thinking: void 0, outputConfig: void 0 };
  }
  return thinkingFor(level.value, budget);
}
function thinkingFor(effort, budget) {
  const resolved = budget > 0 ? budget : budgetForEffort(effort);
  return {
    thinking: { type: "enabled", budget_tokens: resolved },
    outputConfig: { effort }
  };
}
function responsesReasoning(value) {
  if (isPlainObject(value)) {
    if (stringAt(value, "type") === "disabled") {
      return void 0;
    }
    const effort = reasoningEffort(value);
    if (effort !== void 0) {
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
      if (normalized.value === void 0) {
        return void 0;
      }
      return { effort: normalized.value };
    }
    return { effort: value };
  }
  return value;
}

// src/protocol/decode-request-chat.ts
function decodeChatRequest(request, input) {
  request.maxTokens = firstAny(
    input["max_completion_tokens"],
    input["max_tokens"]
  );
  request.stop = input["stop"];
  request.reasoning = firstAny(input["reasoning_effort"], input["reasoning"]);
  const rawMessages = sliceAt(input, "messages");
  for (let i = 0; i < rawMessages.length; i++) {
    const message = rawMessages[i];
    if (!isPlainObject(message)) {
      throw new ProtocolError(`messages[${i}] must be an object`);
    }
    const role = stringAt(message, "role");
    let blocks;
    try {
      blocks = decodeOpenAIBlocks(message["content"]);
    } catch (error) {
      throw new ProtocolError(`messages[${i}]: ${error.message}`);
    }
    if (role === "assistant") {
      blocks = [...decodeChatReasoning(message), ...blocks];
      const budget = intAt(message, "reasoning_budget_tokens");
      if (budget > 0) {
        request.reasoning = withReasoningBudget(request.reasoning, budget);
      }
    }
    const rawCalls = sliceAt(message, "tool_calls");
    for (let j = 0; j < rawCalls.length; j++) {
      const call = rawCalls[j];
      if (!isPlainObject(call)) {
        throw new ProtocolError(`messages[${i}].tool_calls[${j}] must be an object`);
      }
      const fn = mapAt(call, "function");
      const block = emptyBlock("tool_call");
      block.id = stringAt(call, "id");
      block.name = stringAt(fn, "name");
      block.argumentsJSON = stringAt(fn, "arguments");
      blocks.push(block);
    }
    switch (role) {
      case "system":
        request.system.push(...blocks);
        break;
      case "developer":
        request.developer.push(...blocks);
        break;
      case "tool": {
        const block = emptyBlock("tool_result");
        block.callId = stringAt(message, "tool_call_id");
        block.result = message["content"];
        request.messages.push({ role: "user", blocks: [block] });
        break;
      }
      case "user":
      case "assistant":
        request.messages.push({
          role,
          blocks
        });
        break;
      default:
        throw new ProtocolError(
          `messages[${i}] has unsupported role ${JSON.stringify(role)}`
        );
    }
  }
  const rawTools = sliceAt(input, "tools");
  for (let i = 0; i < rawTools.length; i++) {
    const tool = rawTools[i];
    if (!isPlainObject(tool) || stringAt(tool, "type") !== "function") {
      throw new ProtocolError(`tools[${i}] must be a function tool`);
    }
    const fn = mapAt(tool, "function");
    request.tools.push(chatTool(fn));
  }
  request.toolChoice = decodeChatToolChoice(input["tool_choice"]);
  request.responseFormat = input["response_format"];
  request.parallelToolCalls = input["parallel_tool_calls"];
  request.frequencyPenalty = input["frequency_penalty"];
  request.presencePenalty = input["presence_penalty"];
  request.seed = input["seed"];
  request.promptCacheKey = input["prompt_cache_key"];
  request.safetyIdentifier = input["safety_identifier"];
  request.serviceTier = input["service_tier"];
  request.store = input["store"];
}
function chatTool(fn) {
  return {
    name: stringAt(fn, "name"),
    description: stringAt(fn, "description"),
    schema: fn["parameters"],
    strict: boolAt(fn, "strict") ?? false
  };
}

// src/protocol/decode-request-responses.ts
function decodeResponsesRequest(request, input) {
  request.maxTokens = input["max_output_tokens"];
  request.stop = input["stop"];
  request.reasoning = firstAny(input["reasoning"], input["reasoning_effort"]);
  try {
    request.system.push(...decodeOpenAIBlocks(input["instructions"]));
  } catch (error) {
    throw new ProtocolError(`instructions: ${error.message}`);
  }
  const value = input["input"];
  if (typeof value === "string") {
    request.messages.push({
      role: "user",
      blocks: [{ ...emptyBlock("text"), text: value }]
    });
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (!isPlainObject(item)) {
        throw new ProtocolError(`input[${i}] must be an object`);
      }
      decodeResponsesItem(request, item, i);
    }
  } else {
    throw new ProtocolError("input must be a string or array");
  }
  const rawTools = sliceAt(input, "tools");
  for (let i = 0; i < rawTools.length; i++) {
    const tool = rawTools[i];
    if (!isPlainObject(tool)) {
      throw new ProtocolError(`tools[${i}] must be an object`);
    }
    if (stringAt(tool, "type") !== "function") {
      continue;
    }
    request.tools.push(responsesTool(tool));
  }
  request.toolChoice = decodeResponsesToolChoice(input["tool_choice"]);
  request.responseFormat = mapAt(input, "text", "format");
  request.parallelToolCalls = input["parallel_tool_calls"];
  request.promptCacheKey = input["prompt_cache_key"];
  request.safetyIdentifier = input["safety_identifier"];
  request.serviceTier = input["service_tier"];
  request.store = input["store"];
}
function decodeResponsesItem(request, item, index) {
  switch (stringAt(item, "type")) {
    case "reasoning":
      for (const block of decodeResponsesReasoning(item)) {
        appendBridgeBlock(request.messages, "assistant", block);
      }
      return;
    case "function_call": {
      const block = emptyBlock("tool_call");
      block.id = firstString(stringAt(item, "call_id"), stringAt(item, "id"));
      block.name = stringAt(item, "name");
      block.argumentsJSON = stringAt(item, "arguments");
      appendBridgeBlock(request.messages, "assistant", block);
      return;
    }
    case "function_call_output": {
      const block = emptyBlock("tool_result");
      block.callId = stringAt(item, "call_id");
      block.result = item["output"];
      appendBridgeBlock(request.messages, "user", block);
      return;
    }
    case "message":
    case "": {
      const role = stringAt(item, "role");
      let blocks;
      try {
        blocks = decodeOpenAIBlocks(item["content"]);
      } catch (error) {
        throw new ProtocolError(`input[${index}]: ${error.message}`);
      }
      if (role === "system") {
        request.system.push(...blocks);
      } else if (role === "developer") {
        request.developer.push(...blocks);
      } else if (role === "user" || role === "assistant") {
        request.messages.push({ role, blocks });
      }
      return;
    }
    default:
      throw new ProtocolError(
        `input[${index}] has unsupported Responses item type ${JSON.stringify(stringAt(item, "type"))}`
      );
  }
}
function responsesTool(tool) {
  return {
    name: stringAt(tool, "name"),
    description: stringAt(tool, "description"),
    schema: tool["parameters"],
    strict: boolAt(tool, "strict") ?? false
  };
}

// src/protocol/decode-request-anthropic.ts
function decodeAnthropicRequest(request, input) {
  request.maxTokens = input["max_tokens"];
  request.stop = input["stop_sequences"];
  request.reasoning = anthropicReasoning(input);
  try {
    request.system = decodeAnthropicBlocks(input["system"]);
  } catch (error) {
    throw new ProtocolError(`system: ${error.message}`);
  }
  const rawMessages = sliceAt(input, "messages");
  for (let i = 0; i < rawMessages.length; i++) {
    const message = rawMessages[i];
    if (!isPlainObject(message)) {
      throw new ProtocolError(`messages[${i}] must be an object`);
    }
    const role = stringAt(message, "role");
    if (role === "system" || role === "developer") {
      const blocks = decodeMessageBlocks(message, i);
      if (role === "system") {
        request.system.push(...blocks);
      } else {
        request.developer.push(...blocks);
      }
      continue;
    }
    if (role !== "user" && role !== "assistant") {
      throw new ProtocolError(
        `messages[${i}] has unsupported role ${JSON.stringify(role)}`
      );
    }
    request.messages.push({ role, blocks: decodeMessageBlocks(message, i) });
  }
  const rawTools = sliceAt(input, "tools");
  for (let i = 0; i < rawTools.length; i++) {
    const tool = rawTools[i];
    if (!isPlainObject(tool)) {
      throw new ProtocolError(`tools[${i}] must be an object`);
    }
    request.tools.push(anthropicTool(tool));
  }
  request.toolChoice = decodeAnthropicToolChoice(input["tool_choice"]);
}
function decodeMessageBlocks(message, index) {
  try {
    return decodeAnthropicBlocks(message["content"]);
  } catch (error) {
    throw new ProtocolError(`messages[${index}]: ${error.message}`);
  }
}
function anthropicTool(tool) {
  return {
    name: stringAt(tool, "name"),
    description: stringAt(tool, "description"),
    schema: tool["input_schema"],
    strict: false
  };
}

// src/protocol/decode-request.ts
function decodeBridgeRequest(protocol, input) {
  const request = {
    model: stringOrEmpty(input["model"]),
    system: [],
    developer: [],
    messages: [],
    tools: [],
    toolChoice: emptyToolChoice(),
    stream: boolAt(input, "stream") ?? false,
    temperature: input["temperature"],
    topP: input["top_p"],
    maxTokens: void 0,
    stop: void 0,
    reasoning: void 0,
    metadata: input["metadata"],
    responseFormat: void 0,
    parallelToolCalls: void 0,
    frequencyPenalty: void 0,
    presencePenalty: void 0,
    seed: void 0,
    promptCacheKey: void 0,
    safetyIdentifier: void 0,
    serviceTier: void 0,
    store: void 0
  };
  switch (protocol) {
    case "chat":
      decodeChatRequest(request, input);
      break;
    case "responses":
      decodeResponsesRequest(request, input);
      break;
    case "anthropic":
      decodeAnthropicRequest(request, input);
      break;
    default:
      throw new ProtocolError(
        `unsupported input protocol ${JSON.stringify(protocol)}`
      );
  }
  applyToolImages(request, protocol);
  return request;
}
function applyToolImages(request, protocol) {
  if (protocol === "chat") {
    return;
  }
  for (let i = 0; i < request.messages.length; i++) {
    const message = request.messages[i];
    if (message === void 0) {
      continue;
    }
    const blocks = message.blocks;
    for (let j = 0; j < blocks.length; j++) {
      const block = blocks[j];
      if (block === void 0 || block.kind !== "tool_result") {
        continue;
      }
      const result = decodeToolImages(protocol, block.result);
      if (Array.isArray(result) && result.every((item) => isPlainObject(item) && "kind" in item) && block.callId === "") {
        throw new ProtocolError(
          `messages[${i}]: tool image result requires a call ID`
        );
      }
      blocks[j] = { ...block, result };
    }
  }
}
function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

// src/protocol/encode-chat.ts
function encodeChatRequest(request) {
  const output = {
    model: request.model,
    stream: request.stream
  };
  put(output, "temperature", request.temperature);
  put(output, "top_p", request.topP);
  put(output, "max_tokens", request.maxTokens);
  put(output, "stop", request.stop);
  const effort = reasoningEffort(request.reasoning);
  if (effort !== void 0 && effort !== null) {
    output["reasoning_effort"] = effort;
  }
  put(output, "response_format", chatResponseFormat(request.responseFormat));
  put(output, "parallel_tool_calls", request.parallelToolCalls);
  put(output, "frequency_penalty", request.frequencyPenalty);
  put(output, "presence_penalty", request.presencePenalty);
  put(output, "seed", request.seed);
  put(output, "prompt_cache_key", request.promptCacheKey);
  put(output, "safety_identifier", request.safetyIdentifier);
  put(output, "service_tier", request.serviceTier);
  put(output, "store", request.store);
  if (request.stream) {
    output["stream_options"] = { include_usage: true };
  }
  const messages = [];
  if (request.system.length > 0) {
    messages.push({
      role: "system",
      content: encodeChatBlocks(request.system)
    });
  }
  if (request.developer.length > 0) {
    messages.push({
      role: "developer",
      content: encodeChatBlocks(request.developer)
    });
  }
  const state = {
    pending: /* @__PURE__ */ new Set(),
    pendingResults: /* @__PURE__ */ new Map(),
    pendingOrder: [],
    deferred: [],
    budgetCarried: false
  };
  for (let i = 0; i < request.messages.length; i++) {
    const message = request.messages[i];
    if (message === void 0) {
      continue;
    }
    const { content, reasoning, calls, results } = splitBlocks(message);
    if (message.role === "assistant") {
      if (state.pending.size > 0) {
        throw new ProtocolError(
          `messages[${i}]: assistant message appears before tool results for ${missingToolIDs(
            state
          ).join(", ")}`
        );
      }
      if (results.length > 0) {
        throw new ProtocolError(
          `messages[${i}]: assistant message contains tool results`
        );
      }
      const encoded = { role: "assistant", content: null };
      carryBudget(state, encoded, request);
      const reasoningText = bridgeReasoningText(reasoning);
      if (reasoningText.ok) {
        encoded["reasoning_content"] = reasoningText.text;
      }
      if (content.length > 0) {
        encoded["content"] = encodeChatBlocks(content);
      }
      if (calls.length > 0) {
        const toolCalls = [];
        for (const call of calls) {
          if (call.id === "" || call.name === "") {
            throw new ProtocolError(
              `messages[${i}]: tool call must contain id and name`
            );
          }
          if (state.pending.has(call.id)) {
            throw new ProtocolError(
              `messages[${i}]: duplicate tool call id ${JSON.stringify(call.id)}`
            );
          }
          state.pending.add(call.id);
          state.pendingOrder.push(call.id);
          toolCalls.push({
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments: bridgeArgumentsJSON(call)
            }
          });
        }
        encoded["tool_calls"] = toolCalls;
      }
      if (content.length > 0 || reasoning.length > 0 || calls.length > 0) {
        messages.push(encoded);
        state.budgetCarried = true;
      }
      continue;
    }
    if (calls.length > 0) {
      throw new ProtocolError(
        `messages[${i}]: user message contains tool calls`
      );
    }
    for (const result of results) {
      if (state.pendingResults.has(result.callId)) {
        throw new ProtocolError(
          `messages[${i}]: duplicate tool result ${JSON.stringify(result.callId)}`
        );
      }
      if (!state.pending.has(result.callId)) {
        throw new ProtocolError(
          `messages[${i}]: tool result ${JSON.stringify(result.callId)} has no pending tool call`
        );
      }
      state.pendingResults.set(result.callId, result);
      state.pending.delete(result.callId);
    }
    if (content.length > 0) {
      if (state.pendingOrder.length > 0 || state.deferred.length > 0) {
        state.deferred.push(content);
      } else {
        messages.push({ role: "user", content: encodeChatBlocks(content) });
      }
    }
    if (state.pending.size === 0 && state.pendingOrder.length > 0) {
      const attachments = [];
      for (const id of state.pendingOrder) {
        const result = state.pendingResults.get(id);
        if (!result) {
          continue;
        }
        const { text, images } = chatToolImages(result);
        if (images.length > 0) {
          attachments.push({
            role: "user",
            content: encodeChatBlocks(images)
          });
        }
        messages.push({ role: "tool", tool_call_id: id, content: text });
      }
      messages.push(...attachments);
      flushDeferred(state, messages);
      state.pendingOrder = [];
      state.pendingResults.clear();
    }
  }
  if (state.pending.size > 0) {
    throw new ProtocolError(
      `tool calls are missing results for ${missingToolIDs(state).join(", ")}`
    );
  }
  flushDeferred(state, messages);
  carryBudgetOnly(state, messages, request);
  output["messages"] = messages;
  if (request.tools.length > 0) {
    const tools = request.tools.map((tool) => {
      const fn = {
        name: tool.name,
        description: tool.description,
        parameters: schemaOrDefault(tool.schema)
      };
      if (tool.strict) {
        fn["strict"] = true;
      }
      return { type: "function", function: fn };
    });
    output["tools"] = tools;
    const choice = encodeChatToolChoice(request.toolChoice);
    if (choice !== void 0) {
      output["tool_choice"] = choice;
    }
  }
  return output;
}
function splitBlocks(message) {
  const content = [];
  const reasoning = [];
  const calls = [];
  const results = [];
  for (const block of message.blocks) {
    switch (block.kind) {
      case "reasoning":
        reasoning.push(block);
        break;
      case "tool_call":
        calls.push(block);
        break;
      case "tool_result":
        results.push(block);
        break;
      default:
        content.push(block);
        break;
    }
  }
  return { content, reasoning, calls, results };
}
function carryBudget(state, encoded, request) {
  if (state.budgetCarried) {
    return;
  }
  const budget = reasoningBudget(request.reasoning);
  if (budget > 0) {
    encoded["reasoning_budget_tokens"] = budget;
    state.budgetCarried = true;
  }
}
function carryBudgetOnly(state, messages, request) {
  if (state.budgetCarried) {
    return;
  }
  if (reasoningBudget(request.reasoning) <= 0) {
    return;
  }
  const encoded = { role: "assistant", content: null };
  carryBudget(state, encoded, request);
  if (encoded["reasoning_budget_tokens"] === void 0) {
    return;
  }
  messages.push(encoded);
}
function flushDeferred(state, messages) {
  for (const blocks of state.deferred) {
    if (blocks.length > 0) {
      messages.push({ role: "user", content: encodeChatBlocks(blocks) });
    }
  }
  state.deferred = [];
}
function missingToolIDs(state) {
  const missing = [];
  for (const id of state.pendingOrder) {
    if (state.pending.has(id)) {
      missing.push(id);
    }
  }
  if (missing.length === state.pending.size) {
    return missing;
  }
  for (const id of state.pending) {
    if (!missing.includes(id)) {
      missing.push(id);
    }
  }
  return missing.sort();
}

// src/protocol/encode-responses.ts
function encodeResponsesRequest(request) {
  const output = {
    model: request.model,
    stream: request.stream
  };
  put(output, "temperature", request.temperature);
  put(output, "top_p", request.topP);
  put(output, "max_output_tokens", floorResponsesMaxTokens(request.maxTokens));
  put(output, "stop", request.stop);
  put(output, "metadata", request.metadata);
  if (request.system.length > 0) {
    output["instructions"] = bridgeBlocksText(request.system);
  }
  if (request.reasoning !== void 0 && request.reasoning !== null) {
    const reasoning = responsesReasoning(request.reasoning);
    if (reasoning !== void 0 && reasoning !== null) {
      output["reasoning"] = reasoning;
    }
  }
  const format = responsesTextFormat(request.responseFormat);
  if (format !== void 0) {
    output["text"] = { format };
  }
  put(output, "parallel_tool_calls", request.parallelToolCalls);
  put(output, "prompt_cache_key", request.promptCacheKey);
  put(output, "safety_identifier", request.safetyIdentifier);
  put(output, "service_tier", request.serviceTier);
  put(output, "store", request.store);
  const items = [];
  if (request.developer.length > 0) {
    items.push({
      type: "message",
      role: "developer",
      content: [
        { type: "input_text", text: bridgeBlocksText(request.developer) }
      ]
    });
  }
  for (const message of request.messages) {
    let content = [];
    const flushContent = () => {
      if (content.length === 0) {
        return;
      }
      items.push({
        type: "message",
        role: normalizeResponsesRole(message.role),
        content
      });
      content = [];
    };
    for (const block of message.blocks) {
      switch (block.kind) {
        case "reasoning": {
          flushContent();
          const encoded = encodeResponsesReasoningInput(block);
          if (encoded.ok) {
            items.push(encoded.item);
          }
          break;
        }
        case "text": {
          const kind = message.role === "assistant" ? "output_text" : "input_text";
          content.push({ type: kind, text: block.text });
          break;
        }
        case "image": {
          let url = block.url;
          if (url === "" && block.data !== "") {
            url = `data:${block.mediaType};base64,${block.data}`;
          }
          content.push({ type: "input_image", image_url: url });
          break;
        }
        case "file": {
          const item = { type: "input_file" };
          put(item, "file_id", block.fileId);
          put(item, "file_data", block.data);
          put(item, "filename", block.filename);
          content.push(item);
          break;
        }
        case "tool_call": {
          flushContent();
          items.push({
            type: "function_call",
            call_id: block.id,
            name: block.name,
            arguments: bridgeArgumentsJSON(block)
          });
          break;
        }
        case "tool_result": {
          flushContent();
          items.push({
            type: "function_call_output",
            call_id: block.callId,
            output: responsesToolContent(block.result)
          });
          break;
        }
        default:
          break;
      }
    }
    flushContent();
  }
  output["input"] = items;
  if (request.tools.length > 0) {
    const tools = request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: schemaOrDefault(tool.schema),
      strict: tool.strict
    }));
    output["tools"] = tools;
    const choice = encodeResponsesToolChoice(request.toolChoice);
    if (choice !== void 0) {
      output["tool_choice"] = choice;
    }
  }
  return output;
}

// src/protocol/encode-anthropic.ts
var DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;
function encodeAnthropicRequest(request) {
  const output = {
    model: request.model,
    stream: request.stream
  };
  put(output, "temperature", request.temperature);
  put(output, "top_p", request.topP);
  put(output, "stop_sequences", request.stop);
  output["max_tokens"] = request.maxTokens === void 0 || request.maxTokens === null ? DEFAULT_ANTHROPIC_MAX_TOKENS : request.maxTokens;
  const thinking = anthropicThinking(request.reasoning);
  if (thinking.thinking) {
    output["thinking"] = thinking.thinking;
    if (thinking.outputConfig) {
      output["output_config"] = thinking.outputConfig;
    }
  }
  if (request.system.length > 0 || request.developer.length > 0) {
    const instructions = [...request.system, ...request.developer];
    output["system"] = encodeAnthropicBlocks(instructions);
  }
  const messages = [];
  for (const message of request.messages) {
    const content = encodeAnthropicBlocks(message.blocks);
    if (content.length === 0) {
      continue;
    }
    const role = message.role === "assistant" ? "assistant" : "user";
    const last = messages[messages.length - 1];
    if (last && last["role"] === role) {
      const previous = last["content"];
      const merged = Array.isArray(previous) ? previous : [];
      last["content"] = [...merged, ...content];
      continue;
    }
    messages.push({ role, content });
  }
  output["messages"] = messages;
  if (request.tools.length > 0 && request.toolChoice.mode !== "none") {
    const tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: schemaOrDefault(tool.schema)
    }));
    output["tools"] = tools;
    const choice = encodeAnthropicToolChoice(request.toolChoice);
    if (choice !== void 0) {
      output["tool_choice"] = choice;
    }
  }
  return output;
}

// src/protocol/encode-request.ts
function encodeBridgeRequest(protocol, request) {
  switch (protocol) {
    case "chat":
      return encodeChatRequest(request);
    case "responses":
      return encodeResponsesRequest(request);
    case "anthropic":
      return encodeAnthropicRequest(request);
    default:
      throw new ProtocolError(
        `unsupported output protocol ${JSON.stringify(protocol)}`
      );
  }
}
function validateBridgeRequest(protocol, request) {
  const system = [...request.system, ...request.developer];
  for (const block of system) {
    if (block.kind !== "file") {
      continue;
    }
    if (protocol === "responses") {
      throw new ProtocolError(
        "system blocks cannot contain a file for the responses protocol"
      );
    }
    if (block.fileId !== "" && block.data === "" && block.url === "") {
      throw new ProtocolError(
        `file ${JSON.stringify(block.fileId)} is only known by an upstream file id`
      );
    }
  }
}

// src/protocol/convert.ts
function convertRequest(from, to, input) {
  if (from === to) {
    return structuredClone(input);
  }
  const request = decodeBridgeRequest(from, input);
  validateBridgeRequest(to, request);
  return encodeBridgeRequest(to, request);
}

// src/protocol/response-decode.ts
function decodeChatReasoning2(message) {
  let value = message["reasoning_content"];
  if (value === void 0) {
    value = message["reasoning"];
  }
  if (typeof value !== "string") {
    return [];
  }
  const block = emptyBlock("reasoning");
  block.text = value;
  block.signature = stringAt(message, "reasoning_signature");
  return [block];
}
function decodeResponsesReasoning2(item) {
  let text = "";
  for (const raw of asArray(item["summary"])) {
    text += stringAt(raw, "text");
  }
  const content = item["content"];
  if (content !== void 0 && content !== null) {
    for (const raw of asArray(content)) {
      text += stringAt(raw, "text");
    }
  }
  const encrypted = stringAt(item, "encrypted_content");
  if (text === "" && encrypted === "") {
    return [];
  }
  const block = emptyBlock("reasoning");
  block.id = stringAt(item, "id");
  block.text = text;
  block.encrypted = encrypted;
  return [block];
}
function asArray(value) {
  if (value === void 0 || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
function decodeBridgeResponse(protocol, input) {
  const response = {
    id: stringAt(input, "id"),
    model: stringAt(input, "model"),
    text: "",
    reasoning: [],
    tools: [],
    stop: "",
    error: "",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0
    },
    created: intAt(input, "created")
  };
  if (response.created === 0) {
    response.created = intAt(input, "created_at");
  }
  if (response.created === 0) {
    response.created = Math.floor(Date.now() / 1e3);
  }
  switch (protocol) {
    case "chat":
      decodeChatResponse(response, input);
      break;
    case "responses":
      decodeResponsesResponse(response, input);
      break;
    case "anthropic":
      decodeAnthropicResponse(response, input);
      break;
    default:
      throw new ProtocolError(
        `unsupported response protocol ${JSON.stringify(protocol)}`
      );
  }
  return response;
}
function decodeChatResponse(response, input) {
  const message = stringAt(input, "error", "message");
  if (message !== "") {
    response.error = message;
    return;
  }
  const choices = sliceAt(input, "choices");
  if (choices.length === 0) {
    throw new ProtocolError("chat response contains no choices");
  }
  const choice = choices[0];
  const body = isPlainObject(choice) ? choice : {};
  const messageBody = isPlainObject(body["message"]) ? body["message"] : {};
  response.reasoning = decodeChatReasoning2(messageBody);
  const blocks = decodeOpenAIBlocks(messageBody["content"]);
  response.text = responseTextBlocks(blocks, "Chat");
  for (const raw of sliceAt(messageBody, "tool_calls")) {
    const call = isPlainObject(raw) ? raw : {};
    const fn = isPlainObject(call["function"]) ? call["function"] : {};
    const block = emptyBlock("tool_call");
    block.id = stringAt(call, "id");
    block.name = stringAt(fn, "name");
    block.argumentsJSON = stringAt(fn, "arguments");
    response.tools.push(block);
  }
  response.stop = canonicalChatStop(stringAt(body, "finish_reason"));
  response.usage = decodeOpenAIUsage(mapOrEmpty(input, "usage"));
}
function decodeResponsesResponse(response, input) {
  for (const raw of sliceAt(input, "output")) {
    const item = isPlainObject(raw) ? raw : {};
    switch (stringAt(item, "type")) {
      case "reasoning":
        response.reasoning.push(...decodeResponsesReasoning2(item));
        break;
      case "message": {
        const blocks = decodeOpenAIBlocks(item["content"]);
        response.text += responseTextBlocks(blocks, "Responses");
        break;
      }
      case "function_call": {
        const block = emptyBlock("tool_call");
        block.id = firstString(stringAt(item, "call_id"), stringAt(item, "id"));
        block.name = stringAt(item, "name");
        block.argumentsJSON = stringAt(item, "arguments");
        response.tools.push(block);
        break;
      }
      default:
        throw new ProtocolError(
          `Responses response has unsupported output item type ${JSON.stringify(stringAt(item, "type"))}`
        );
    }
  }
  response.stop = response.tools.length > 0 ? "tool_calls" : "stop";
  const status = stringAt(input, "status");
  if (status === "incomplete") {
    response.stop = canonicalResponsesIncomplete(
      stringAt(input, "incomplete_details", "reason")
    );
  } else if (status === "failed") {
    response.stop = "error";
    response.error = firstString(
      stringAt(input, "error", "message"),
      "upstream Responses request failed"
    );
  }
  response.usage = decodeOpenAIUsage(mapOrEmpty(input, "usage"));
}
function decodeAnthropicResponse(response, input) {
  if (stringAt(input, "type") === "error") {
    response.error = firstString(
      stringAt(input, "error", "message"),
      "upstream Anthropic request failed"
    );
  }
  const blocks = decodeAnthropicBlocks(input["content"]);
  for (const block of blocks) {
    if (block.kind === "reasoning") {
      response.reasoning.push(block);
    } else if (block.kind === "text") {
      response.text += block.text;
    } else if (block.kind === "tool_call") {
      response.tools.push(block);
    } else {
      throw new ProtocolError(
        `Anthropic response contains unsupported ${block.kind} content block`
      );
    }
  }
  response.stop = canonicalAnthropicStop(stringAt(input, "stop_reason"));
  response.usage = decodeAnthropicUsage(mapOrEmpty(input, "usage"));
}
function mapOrEmpty(value, key) {
  const found = value[key];
  return isPlainObject(found) ? found : {};
}
function responseTextBlocks(blocks, protocol) {
  let text = "";
  for (const block of blocks) {
    if (block.kind !== "text") {
      throw new ProtocolError(
        `${protocol} response contains unsupported ${block.kind} content block`
      );
    }
    text += block.text;
  }
  return text;
}

// src/protocol/response.ts
function convertResponse(from, to, body) {
  if (from === to) {
    return body;
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new ProtocolError(
      `invalid upstream response JSON: ${error.message}`
    );
  }
  if (!isPlainObject(parsed)) {
    throw new ProtocolError("upstream response must be a JSON object");
  }
  const response = decodeBridgeResponse(from, parsed);
  if (response.error !== "" || response.stop === "error") {
    throw new ProtocolError(
      `upstream response failed: ${response.error !== "" ? response.error : "upstream response failed"}`
    );
  }
  return JSON.stringify(encodeBridgeResponse(to, response));
}
function renameResponseTool(body, protocol, fromName, toName) {
  if (fromName === "" || toName === "" || fromName === toName || body === "") {
    return body;
  }
  if (!body.includes(fromName)) {
    return body;
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (!isPlainObject(parsed)) {
    return body;
  }
  if (!renameToolInMap(parsed, protocol, fromName, toName)) {
    return body;
  }
  return JSON.stringify(parsed);
}
function renameToolInMap(payload, protocol, fromName, toName) {
  let changed = false;
  switch (protocol) {
    case "chat": {
      for (const rawChoice of sliceAt(payload, "choices")) {
        const choice = isPlainObject(rawChoice) ? rawChoice : {};
        for (const key of ["message", "delta"]) {
          const container = isPlainObject(choice[key]) ? choice[key] : {};
          for (const rawCall of sliceAt(container, "tool_calls")) {
            const call = isPlainObject(rawCall) ? rawCall : {};
            const fn = call["function"];
            if (isPlainObject(fn) && stringAt(fn, "name") === fromName) {
              fn["name"] = toName;
              changed = true;
            }
          }
        }
      }
      break;
    }
    case "responses": {
      const item = payload["item"];
      if (isPlainObject(item) && stringAt(item, "type") === "function_call" && stringAt(item, "name") === fromName) {
        item["name"] = toName;
        changed = true;
      }
      changed = renameItems(sliceAt(payload, "output"), fromName, toName) || changed;
      const envelope = payload["response"];
      if (isPlainObject(envelope)) {
        changed = renameItems(sliceAt(envelope, "output"), fromName, toName) || changed;
      }
      break;
    }
    case "anthropic": {
      const block = payload["content_block"];
      if (isPlainObject(block) && stringAt(block, "type") === "tool_use" && stringAt(block, "name") === fromName) {
        block["name"] = toName;
        changed = true;
      }
      changed = renameItems(sliceAt(payload, "content"), fromName, toName) || changed;
      break;
    }
    default:
      break;
  }
  return changed;
}
function renameItems(items, fromName, toName) {
  let changed = false;
  for (const raw of items) {
    const item = isPlainObject(raw) ? raw : {};
    const isTool = stringAt(item, "type") === "function_call" || stringAt(item, "type") === "tool_use";
    if (isTool && stringAt(item, "name") === fromName) {
      item["name"] = toName;
      changed = true;
    }
  }
  return changed;
}

// src/protocol/tools/opencode_tools.json
var opencode_tools_default = {
  edit: {
    description: "Edit the contents of a file by finding and replacing exact text. When editing text from Read output, preserve the exact indentation (tabs or spaces) and omit the line-number prefix, such as `1: `. Never include the prefix in oldString or newString. Write line breaks as \\n; the file's existing CRLF or LF line endings are matched and preserved. To change line endings themselves, make oldString and newString differ only in \\r; that edit applies to the exact bytes. If there is no exact match, the edit retries while ignoring typographic quote, dash, and space variants, then trailing whitespace on each line. The edit fails if oldString is not found. By default, oldString must identify a UNIQUE location. Multiple matches FAIL unless replaceAll is true. Add more surrounding context to disambiguate, or set replaceAll to true to replace every occurrence. Use replaceAll when the change should apply to every occurrence, such as renaming a variable.",
    parameters: {
      additionalProperties: false,
      properties: {
        newString: {
          description: "Text to replace oldString with (must differ from oldString)",
          type: "string"
        },
        oldString: {
          description: "Exact text to find and replace",
          type: "string"
        },
        path: {
          description: "File to edit",
          type: "string"
        },
        replaceAll: {
          description: "Whether to replace every occurrence of oldString. When false, oldString must match exactly once. Defaults to false.",
          type: "boolean"
        }
      },
      required: ["path", "oldString", "newString"],
      type: "object"
    }
  },
  execute: {
    description: 'Run JavaScript in a confined Code Mode runtime to script tool calls and HTTP requests and compose their results.\n`fetch` is available for HTTP requests. Imports, direct filesystem access, and timers are unavailable; all other external access goes through `tools`.\nWithin `{ code }`, the only callable tools are those explicitly listed in the Code Mode catalog instructions or returned by the `search` function. Inside `{ code }`, ignore tools shown outside the Code Mode catalog. They are not available in the Code Mode runtime.\nCall tools through `tools` using only exact paths and signatures from the catalog. Do not infer or normalize tool names; preserve bracket notation such as `tools.<namespace>["tool-name"](input)`.\nPrefer an explicit `return`; if omitted, the final top-level expression becomes the result.\nAwait every call whose completion matters; pending calls are interrupted when execution ends. Run independent calls concurrently with `Promise.allSettled`.',
    parameters: {
      additionalProperties: false,
      properties: {
        code: {
          type: "string"
        }
      },
      required: ["code"],
      type: "object"
    }
  },
  glob: {
    description: 'Search file paths using a glob pattern (examples: "**/*.ts", "src/**/*.tsx").',
    parameters: {
      additionalProperties: false,
      properties: {
        hidden: {
          description: "Include hidden files and directories (default: false).",
          type: "boolean"
        },
        limit: {
          description: "Maximum number of matching files to return (default: 100)",
          exclusiveMinimum: 0,
          type: "integer"
        },
        path: {
          description: "Directory to search. Defaults to the current working directory.",
          type: "string"
        },
        pattern: {
          description: "Glob pattern to match files against",
          type: "string"
        }
      },
      required: ["pattern"],
      type: "object"
    }
  },
  grep: {
    description: "Search file contents using ripgrep's regular expression syntax or literal text matching. Use it to locate specific code, symbols, or text patterns, and narrow searches with `path` or `include`. Returns matching file paths, line numbers, and line previews.",
    parameters: {
      additionalProperties: false,
      properties: {
        caseSensitive: {
          description: "Use case-sensitive matching (default: true).",
          type: "boolean"
        },
        include: {
          description: 'Glob pattern to filter files (for example, "*.js" or "*.{ts,tsx}")',
          type: "string"
        },
        limit: {
          description: "Maximum number of matching lines to return (default: 100)",
          exclusiveMinimum: 0,
          type: "integer"
        },
        literal: {
          description: "Treat `pattern` as exact text instead of a regular expression (default: false).",
          type: "boolean"
        },
        path: {
          description: "File or directory to search. Defaults to the current working directory.",
          type: "string"
        },
        pattern: {
          description: "Regular expression or literal text to match in file contents.",
          minLength: 1,
          type: "string"
        }
      },
      required: ["pattern"],
      type: "object"
    }
  },
  question: {
    description: 'Use this tool when you need to ask the user questions during execution. This allows you to:\n1. Gather user preferences or requirements\n2. Clarify ambiguous instructions\n3. Get decisions on implementation choices as you work\n4. Offer choices to the user about what direction to take.\n\nUsage notes:\n- A "Type your own answer" option is added automatically; don\'t include a separate option for free form answers\n- Set `multiple: true` to allow selecting more than one option\n- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label',
    parameters: {
      additionalProperties: false,
      properties: {
        questions: {
          description: "Questions to ask",
          items: {
            additionalProperties: false,
            properties: {
              header: {
                description: "Very short label (max 30 chars)",
                type: "string"
              },
              multiple: {
                type: "boolean"
              },
              options: {
                description: "Available choices",
                items: {
                  additionalProperties: false,
                  properties: {
                    description: {
                      description: "Explanation of choice",
                      type: "string"
                    },
                    label: {
                      description: "Display text (1-5 words, concise)",
                      type: "string"
                    }
                  },
                  required: ["label", "description"],
                  type: "object"
                },
                type: "array"
              },
              question: {
                description: "Complete question",
                type: "string"
              }
            },
            required: ["question", "header", "options"],
            type: "object"
          },
          minItems: 1,
          type: "array"
        }
      },
      required: ["questions"],
      type: "object"
    }
  },
  read: {
    description: "Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.",
    parameters: {
      additionalProperties: false,
      properties: {
        limit: {
          description: "The maximum number of lines or directory entries to read (defaults to and capped at 2000)",
          minimum: 0,
          type: "integer"
        },
        offset: {
          description: "The line or directory entry to start reading from (1-based)",
          minimum: 0,
          type: "integer"
        },
        path: {
          description: "File or directory to read",
          type: "string"
        }
      },
      required: ["path"],
      type: "object"
    }
  },
  shell: {
    description: "Execute a shell command and return its output. Commands run on Linux using bash. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete.",
    parameters: {
      additionalProperties: false,
      properties: {
        background: {
          description: "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
          type: "boolean"
        },
        command: {
          description: "Shell command string to execute",
          type: "string"
        },
        timeout: {
          description: "Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default.",
          minimum: 0,
          type: "integer"
        },
        workdir: {
          description: "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.",
          type: "string"
        }
      },
      required: ["command"],
      type: "object"
    }
  },
  skill: {
    description: "Load a specialized skill's instructions and resources into the current conversation when the task at hand matches its description.\n\nThe skill ID must match an available skill or a skill explicitly referenced by the user.",
    parameters: {
      additionalProperties: false,
      properties: {
        id: {
          description: "The ID of an available skill or a skill explicitly referenced by the user",
          type: "string"
        }
      },
      required: ["id"],
      type: "object"
    }
  },
  subagent: {
    description: `Spawns an agent in a child session to work on the specified task.
The output includes a sessionID you can pass back later to continue that specific conversation with the subagent.
New child sessions start with fresh context, so include all relevant context and instructions when you don't pass a sessionID.
Foreground (default) runs the subagent to completion and returns its final response.
Background mode (background=true) launches it asynchronously and returns immediately; you are notified when it finishes.
Use background only for independent work that can run while you continue elsewhere.

Available subagents:
- explore: Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.
- general: General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
    parameters: {
      additionalProperties: false,
      properties: {
        agent: {
          description: "The type of specialized agent to use for this task. If the user asks for a subagent by a name that is not one of the available subagents, they most likely mean a model: pick a suitable agent and pass the name through the model parameter instead.",
          type: "string"
        },
        background: {
          description: "Run the subagent in the background and return immediately. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress.",
          type: "boolean"
        },
        description: {
          description: "A short 3-5 word label for the task, displayed to the user",
          type: "string"
        },
        model: {
          description: 'NEVER set this unless the user explicitly asks for a particular model or variant. The value is written as "providerID/modelID", or "providerID/modelID#variant" to include a variant. Do not guess the ID: look the model up with the models tool, filtering to your own provider first.',
          type: "string"
        },
        prompt: {
          description: "The task for the subagent to perform",
          type: "string"
        },
        sessionID: {
          description: "Continue a specific previous subagent conversation by passing its sessionID. Calls without a sessionID start a new conversation.",
          pattern: "^ses",
          type: "string"
        }
      },
      required: ["agent", "description", "prompt"],
      type: "object"
    }
  },
  webfetch: {
    description: "Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default.\n\nUse a more targeted tool when one is available. This tool is read-only. Large text results may be replaced with a preview while the complete output is retained in managed storage.",
    parameters: {
      additionalProperties: false,
      properties: {
        format: {
          description: "The format to return the content in. Defaults to markdown.",
          enum: ["text", "markdown", "html"],
          type: "string"
        },
        timeout: {
          description: "Optional timeout in seconds (maximum: 120)",
          exclusiveMinimum: 0,
          maximum: 120,
          type: "number"
        },
        url: {
          description: "The HTTP or HTTPS URL to fetch content from",
          type: "string"
        }
      },
      required: ["url"],
      type: "object"
    }
  },
  websearch: {
    description: "Search the web using the user's selected search integration. Use this for current information beyond knowledge cutoff.\n\nThe current year is 2026. Use this year when searching for recent information or current events.",
    parameters: {
      additionalProperties: false,
      properties: {
        query: {
          description: "Websearch query",
          type: "string"
        }
      },
      required: ["query"],
      type: "object"
    }
  },
  write: {
    description: "Writes a file to the local filesystem, overwriting if one exists.\n\nMissing parent directories are created automatically.\n\nUse this tool to create new files or overwrite existing files. For partial changes, use the edit tool instead.",
    parameters: {
      additionalProperties: false,
      properties: {
        content: {
          description: "Content to write to the file",
          type: "string"
        },
        path: {
          description: "Path to the file to write to",
          type: "string"
        }
      },
      required: ["path", "content"],
      type: "object"
    }
  }
};

// src/protocol/tools.ts
var V1_READ_TOOL = "read";
var V2_CORE_TOOLS = ["shell", "edit", "glob", "grep", "read"];
var V1_DEPRECATED_READ_DESCRIPTION = "Deprecated. This tool is provided for compatibility only. Do not call it.";
var KNOWN_TOOLS = loadKnownTools();
function loadKnownTools() {
  const map = /* @__PURE__ */ new Map();
  try {
    const raw = opencode_tools_default;
    if (isPlainObject(raw)) {
      for (const [name, value] of Object.entries(raw)) {
        if (!isPlainObject(value)) {
          continue;
        }
        const description = typeof value.description === "string" ? value.description : "";
        const parameters = isPlainObject(value.parameters) ? value.parameters : { type: "object", properties: {} };
        map.set(name, { description, parameters });
      }
    }
  } catch {
  }
  return map;
}
function knownOpencodeTool(name) {
  return KNOWN_TOOLS.get(name);
}
function toolName(protocol, item) {
  if (protocol === "chat") {
    return stringAt(item, "function", "name");
  }
  return stringAt(item, "name");
}
function setToolName(protocol, item, name) {
  if (!isPlainObject(item)) {
    return;
  }
  if (protocol === "chat") {
    const fn = item.function;
    if (isPlainObject(fn)) {
      fn.name = name;
    }
    return;
  }
  item.name = name;
}
function v2Tool(protocol, name) {
  const definition = knownOpencodeTool(name);
  const description = definition?.description ?? `Agent tool ${name}`;
  const parameters = definition?.parameters ?? {
    type: "object",
    properties: {}
  };
  if (protocol === "chat") {
    return {
      type: "function",
      function: { name, description, parameters, strict: false }
    };
  }
  if (protocol === "anthropic") {
    return { name, description, input_schema: parameters };
  }
  return { type: "function", name, description, parameters };
}
function v2Toolset(protocol, names = V2_CORE_TOOLS) {
  return names.map((name) => v2Tool(protocol, name));
}
function isV1ReadToolCandidate(name) {
  const lower = name.trim().toLowerCase();
  if (lower === "") {
    return false;
  }
  if (lower === V1_READ_TOOL) {
    return true;
  }
  const normalized = lower.replace(/[_\-.]/g, "");
  if ([
    "readfile",
    "fileread",
    "readfiles",
    "readtext",
    "readtextfile",
    "readcontent",
    "viewfile"
  ].includes(normalized)) {
    return true;
  }
  return lower.startsWith("read_") || lower.startsWith("read-") || lower.endsWith("_read") || lower.endsWith("-read");
}
function v1DeprecatedReadTool(protocol) {
  const parameters = { type: "object", properties: {} };
  if (protocol === "chat") {
    return {
      type: "function",
      function: {
        name: V1_READ_TOOL,
        description: V1_DEPRECATED_READ_DESCRIPTION,
        parameters
      }
    };
  }
  if (protocol === "anthropic") {
    return {
      name: V1_READ_TOOL,
      description: V1_DEPRECATED_READ_DESCRIPTION,
      input_schema: parameters
    };
  }
  return {
    type: "function",
    name: V1_READ_TOOL,
    description: V1_DEPRECATED_READ_DESCRIPTION,
    parameters
  };
}
function rewriteV1ToolReferences(payload, protocol, fromName, toName) {
  if (fromName === "" || fromName === toName) {
    return;
  }
  if (protocol === "chat") {
    const choice2 = payload.tool_choice;
    if (isPlainObject(choice2) && isPlainObject(choice2.function)) {
      if (choice2.function.name === fromName) {
        choice2.function.name = toName;
      }
    }
    for (const raw of sliceAt(payload, "messages")) {
      for (const rawCall of sliceAt(raw, "tool_calls")) {
        if (isPlainObject(rawCall) && isPlainObject(rawCall.function)) {
          if (rawCall.function.name === fromName) {
            rawCall.function.name = toName;
          }
        }
      }
    }
    return;
  }
  if (protocol === "responses") {
    const choice2 = payload.tool_choice;
    if (isPlainObject(choice2) && choice2.name === fromName) {
      choice2.name = toName;
    }
    for (const item of sliceAt(payload, "input")) {
      if (isPlainObject(item) && item.type === "function_call" && item.name === fromName) {
        item.name = toName;
      }
    }
    return;
  }
  const choice = payload.tool_choice;
  if (isPlainObject(choice) && choice.name === fromName) {
    choice.name = toName;
  }
  for (const msg of sliceAt(payload, "messages")) {
    for (const block of sliceAt(msg, "content")) {
      if (isPlainObject(block) && block.type === "tool_use" && block.name === fromName) {
        block.name = toName;
      }
    }
  }
}
function ensureV1ReadTool(payload, protocol) {
  const raw = payload.tools;
  if (raw === void 0) {
    payload.tools = [v1DeprecatedReadTool(protocol)];
    return { alias: "", changed: true };
  }
  if (!Array.isArray(raw)) {
    return { alias: "", changed: false };
  }
  const items = raw;
  let candidateIndex = -1;
  let candidateName = "";
  let caseFoldCandidate = false;
  for (const [index, item] of items.entries()) {
    const name = toolName(protocol, item);
    if (name === "") {
      continue;
    }
    if (name === V1_READ_TOOL) {
      return { alias: "", changed: false };
    }
    if (name.toLowerCase() === V1_READ_TOOL) {
      if (!caseFoldCandidate) {
        candidateIndex = index;
        candidateName = name;
        caseFoldCandidate = true;
      }
      continue;
    }
    if (candidateIndex < 0 && isV1ReadToolCandidate(name)) {
      candidateIndex = index;
      candidateName = name;
    }
  }
  if (candidateIndex >= 0) {
    setToolName(protocol, items[candidateIndex], V1_READ_TOOL);
    rewriteV1ToolReferences(payload, protocol, candidateName, V1_READ_TOOL);
    payload.tools = items;
    return { alias: candidateName, changed: true };
  }
  items.push(v1DeprecatedReadTool(protocol));
  payload.tools = items;
  return { alias: "", changed: true };
}
function ensureV2Tools(payload, protocol) {
  let changed = false;
  if (protocol === "chat") {
    if (payload.tool_choice === "none") {
      delete payload.tool_choice;
      changed = true;
    }
    if (payload.max_tokens !== void 0) {
      if (payload.max_completion_tokens === void 0) {
        payload.max_completion_tokens = payload.max_tokens;
      }
      delete payload.max_tokens;
      changed = true;
    } else if (payload.max_completion_tokens === void 0) {
      payload.max_completion_tokens = 32e3;
      changed = true;
    }
  }
  const raw = payload.tools;
  if (raw === void 0) {
    payload.tools = v2Toolset(protocol);
    return true;
  }
  if (!Array.isArray(raw)) {
    return changed;
  }
  const items = raw;
  const present = /* @__PURE__ */ new Set();
  for (const [index, item] of items.entries()) {
    const name = toolName(protocol, item);
    if (name === "") {
      continue;
    }
    present.add(name);
    if (knownOpencodeTool(name)) {
      items[index] = v2Tool(protocol, name);
      changed = true;
    }
  }
  const missing = V2_CORE_TOOLS.filter((name) => !present.has(name));
  if (missing.length > 0) {
    items.push(...v2Toolset(protocol, missing));
    changed = true;
  }
  if (!changed) {
    return false;
  }
  payload.tools = items;
  return true;
}
function ensureAnonymousChatUsage(payload, protocol) {
  if (protocol !== "chat") {
    return false;
  }
  const options = payload.stream_options;
  if (!isPlainObject(options)) {
    payload.stream_options = { include_usage: true };
    return true;
  }
  if (options.include_usage === true) {
    return false;
  }
  options.include_usage = true;
  return true;
}
function prepareAnonymousBody(rawBody, protocol, v1) {
  if (protocol === "systemone") {
    return { body: rawBody, alias: "", shaped: false };
  }
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { body: rawBody, alias: "", shaped: false };
  }
  if (!isPlainObject(payload)) {
    return { body: rawBody, alias: "", shaped: false };
  }
  let changed = false;
  if (payload.stream !== true) {
    payload.stream = true;
    changed = true;
  }
  if (ensureAnonymousChatUsage(payload, protocol)) {
    changed = true;
  }
  let alias = "";
  if (v1) {
    const result = ensureV1ReadTool(payload, protocol);
    alias = result.alias;
    if (result.changed) {
      changed = true;
    }
  } else if (ensureV2Tools(payload, protocol)) {
    changed = true;
  }
  if (!changed) {
    return { body: rawBody, alias, shaped: false };
  }
  return { body: JSON.stringify(payload), alias, shaped: true };
}

// src/unlimited/kilo.ts
var KILO_GATEWAY_BASE = "https://api.kilo.ai/api/gateway";
var KILO_ANONYMOUS_TOKEN = "anonymous";
var BUILTIN_FREE_MODELS = [
  "beam-free",
  "deepseek-v4.1-flash-free",
  "glm-5.3-flash-free",
  "mimo-v2.6-flash-free",
  "nemotron-3.5-super-vl-free",
  "nemotron-3.5-lightning-free",
  "flint-40b-free",
  "big-pickle",
  "crouton-alpha-free",
  "iceman-free",
  "inkling-2-small-free",
  "kilo-auto/free",
  "reflection/beam-free",
  "nvidia/nemotron-3.5-super-vl:free",
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "cohere/north-mini-code:free",
  "dots-studio/dots-3-note-preview:free",
  "stealth/crouton-alpha",
  "stealth/glyph-cluster",
  "liquid/lfm-3-1.7b:free",
  "openrouter/free"
];
var KILO_DEFAULT_CHAIN = [
  "reflection/beam-free",
  "kilo-auto/free",
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3.5-super-vl:free",
  "cohere/north-mini-code:free",
  "stealth/crouton-alpha",
  "openrouter/free"
];
var KILO_EQUIVALENTS = {
  "beam-free": "reflection/beam-free",
  "nemotron-3.5-lightning-free": "nvidia/nemotron-3.5-lightning:free",
  "nemotron-3.5-super-vl-free": "nvidia/nemotron-3.5-super-vl:free",
  "nemotron-3-super-free": "nvidia/nemotron-3.5-super-vl:free",
  "crouton-alpha-free": "stealth/crouton-alpha",
  "flint-40b-free": "openrouter/free",
  "deepseek-v4.1-flash-free": "cohere/north-mini-code:free",
  "deepseek-v4.1-flash": "cohere/north-mini-code:free",
  "north-mini-code-free": "cohere/north-mini-code:free",
  "glm-5.3-flash-free": "reflection/beam-free",
  "glm-5.3": "reflection/beam-free",
  "glm-5-free": "reflection/beam-free",
  "mimo-v2.6-flash-free": "reflection/beam-free",
  "mimo-v2-pro-free": "reflection/beam-free",
  "mimo-v2-omni-free": "reflection/beam-free",
  "minimax-m2.5-free": "reflection/beam-free",
  "minimax-m2.5": "reflection/beam-free",
  "big-pickle": "reflection/beam-free",
  "auto": "reflection/beam-free",
  "main": "reflection/beam-free",
  "fast": "reflection/beam-free",
  "sota": "reflection/beam-free",
  "sweet": "reflection/beam-free",
  "deep": "cohere/north-mini-code:free",
  "code": "cohere/north-mini-code:free",
  "vision": "nvidia/nemotron-3.5-super-vl:free",
  "vl": "nvidia/nemotron-3.5-super-vl:free"
};
var OPENCODE_FREE_EQUIVALENTS = {
  "glm-5-free": "glm-5.3-flash-free",
  "glm-5.3": "glm-5.3-flash-free",
  "deepseek-v4.1-flash": "deepseek-v4.1-flash-free",
  "mimo-v2-pro-free": "mimo-v2.6-flash-free",
  "mimo-v2-omni-free": "mimo-v2.6-flash-free",
  "nemotron-3-super-free": "nemotron-3.5-super-vl-free",
  "minimax-m2.5-free": "beam-free",
  "minimax-m2.5": "beam-free",
  "kimi-k2.5-free": "beam-free",
  "kimi-k3": "beam-free",
  "qwen3.6-plus-free": "beam-free",
  "qwen3.8-max": "beam-free",
  "grok-4.6": "beam-free",
  "gpt-5-nano": "beam-free",
  "auto": "beam-free",
  "main": "beam-free",
  "fast": "beam-free",
  "sota": "beam-free",
  "sweet": "beam-free",
  "deep": "deepseek-v4.1-flash-free",
  "code": "deepseek-v4.1-flash-free",
  "vision": "nemotron-3.5-super-vl-free",
  "vl": "nemotron-3.5-super-vl-free",
  "reflection/beam-free": "beam-free",
  "nvidia/nemotron-3.5-lightning:free": "nemotron-3.5-lightning-free",
  "nvidia/nemotron-3.5-super-vl:free": "nemotron-3.5-super-vl-free",
  "stealth/crouton-alpha": "crouton-alpha-free"
};
function stripModelDecorators(raw) {
  let base = raw.trim();
  const parenIndex = base.lastIndexOf("(");
  if (parenIndex > 0 && base.endsWith(")")) {
    base = base.slice(0, parenIndex).trim();
  }
  if (base.startsWith("opencode/")) {
    return base.slice("opencode/".length);
  }
  if (base.startsWith("kilo/")) {
    return base.slice("kilo/".length);
  }
  return base;
}
function isKiloModelId(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("kilo/")) {
    return true;
  }
  const clean = stripModelDecorators(trimmed);
  return clean.includes("/") || clean.endsWith(":free");
}
function resolveOpenCodeFreeModel(raw) {
  const clean = stripModelDecorators(raw);
  return OPENCODE_FREE_EQUIVALENTS[clean] ?? clean;
}
function kiloFallbackChain(raw) {
  const clean = stripModelDecorators(raw);
  const chain = [];
  if (isKiloModelId(raw)) {
    chain.push(clean);
  } else {
    const mapped = KILO_EQUIVALENTS[clean];
    if (mapped !== void 0) {
      chain.push(mapped);
    }
  }
  for (const fallback of KILO_DEFAULT_CHAIN) {
    if (!chain.includes(fallback)) {
      chain.push(fallback);
    }
  }
  return chain;
}
function buildKiloUpstreamRequest(kiloModel, protocol, payload, stream, baseURL = KILO_GATEWAY_BASE) {
  const converted = protocol === "chat" || protocol === "systemone" ? { ...payload } : convertRequest(protocol, "chat", payload);
  const bodyObj = {
    ...converted,
    model: kiloModel,
    stream
  };
  const headers = new Headers({
    Authorization: `Bearer ${KILO_ANONYMOUS_TOKEN}`,
    "Content-Type": "application/json",
    Accept: stream ? "text/event-stream" : "application/json",
    "User-Agent": V2_USER_AGENT
  });
  const url = `${baseURL.replace(/\/+$/, "")}/v1/chat/completions`;
  return {
    url,
    headers,
    body: JSON.stringify(bodyObj)
  };
}
async function normalizeUnlimitedResponse(response, upstreamProtocol, clientProtocol, requestedModel, alias, clientWantsStream) {
  if (clientWantsStream) {
    return response;
  }
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const rawText = await response.text();
  const trimmed = rawText.trimStart();
  const isSSE = contentType.includes("text/event-stream") || trimmed.startsWith("data:") || trimmed.startsWith("event:");
  let jsonText = rawText;
  if (isSSE) {
    const bytes = new TextEncoder().encode(`${rawText}

`);
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield bytes;
      }
    };
    jsonText = await collapseStream(stream, upstreamProtocol, requestedModel);
  }
  if (alias !== "") {
    jsonText = renameResponseTool(jsonText, upstreamProtocol, V1_READ_TOOL, alias);
  }
  if (upstreamProtocol !== clientProtocol) {
    jsonText = convertResponse(upstreamProtocol, clientProtocol, jsonText);
  }
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json");
  return new Response(jsonText, { status: response.status, headers });
}

// src/webui/theme.ts
var THEME_TOKENS = `:root {
  --bg: #0a0a0a;
  --bg-subtle: #171717;
  --surface: #121212;
  --surface-2: #0d0d0d;
  --text-1: #ededed;
  --text-2: #a0a0a0;
  --text-3: #787878;
  --border-1: #262626;
  --border-2: #3a3a3a;
  --inverse-bg: #ededed;
  --inverse-text: #0a0a0a;
  --inverse-hover: #cfcfcf;
  --focus-ring: rgba(237, 237, 237, 0.18);
  --overlay: rgba(0, 0, 0, 0.6);
  --ok: #3fb950;
  --warn: #d29922;
  --warn-bg: rgba(210, 153, 34, 0.15);
  --bad: #f85149;
  --bad-bg: rgba(248, 81, 73, 0.15);
  --fs-xs: 12px;
  --fs-sm: 13px;
  --fs-md: 14px;
  --fs-lg: 16px;
  --fs-xl: 20px;
  --fs-2xl: 24px;
  --fs-3xl: 30px;
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --sp-8: 32px;
  --sp-10: 40px;
  --sp-12: 48px;
  --r-sm: 4px;
  --r-md: 6px;
  --r-lg: 10px;
  --sidebar-w: 232px;
  --content-max: 1280px;
}`;

// src/webui/styles.ts
var WEBUI_STYLES = `
* { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  height: 100%;
  background: var(--bg);
  color: var(--text-1);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Microsoft YaHei", Roboto, Helvetica, Arial, sans-serif;
  font-size: var(--fs-md);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--text-1); text-decoration: none; }
a:hover { color: var(--inverse-hover); }

code, pre, .mono {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
    "Liberation Mono", monospace;
  font-size: var(--fs-sm);
}

#layout { display: flex; min-height: 100%; }

#sidebar {
  width: var(--sidebar-w);
  flex: 0 0 var(--sidebar-w);
  background: var(--surface);
  border-right: 1px solid var(--border-1);
  padding: var(--sp-5) var(--sp-3);
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}

#brand {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--sp-3) var(--sp-5);
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: -0.01em;
}

#brand .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-1);
}

.nav-group { margin-bottom: var(--sp-5); }
.nav-group h3 {
  font-size: var(--fs-xs);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-3);
  padding: 0 var(--sp-3) var(--sp-2);
}

.nav-item {
  display: block;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  color: var(--text-2);
  font-size: var(--fs-sm);
  cursor: pointer;
  border: 1px solid transparent;
}

.nav-item:hover { background: var(--bg-subtle); color: var(--text-1); }
.nav-item.active {
  background: var(--surface-2);
  color: var(--text-1);
  border-color: var(--border-1);
}

#content {
  flex: 1 1 auto;
  max-width: var(--content-max);
  padding: var(--sp-8) var(--sp-8) var(--sp-12);
  min-width: 0;
}

.page-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-4);
  margin-bottom: var(--sp-6);
  flex-wrap: wrap;
}

.page-head h1 { font-size: var(--fs-2xl); font-weight: 600; letter-spacing: -0.02em; }
.page-head p { color: var(--text-3); font-size: var(--fs-sm); }

.card {
  background: var(--surface);
  border: 1px solid var(--border-1);
  border-radius: var(--r-lg);
  padding: var(--sp-5);
  margin-bottom: var(--sp-4);
}

.card h2 {
  font-size: var(--fs-lg);
  font-weight: 600;
  margin-bottom: var(--sp-4);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--sp-4);
}

.stat {
  background: var(--surface);
  border: 1px solid var(--border-1);
  border-radius: var(--r-lg);
  padding: var(--sp-4) var(--sp-5);
}

.stat .label {
  color: var(--text-3);
  font-size: var(--fs-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: var(--sp-2);
}

.stat .value { font-size: var(--fs-3xl); font-weight: 600; letter-spacing: -0.03em; }
.stat .sub { color: var(--text-3); font-size: var(--fs-xs); margin-top: var(--sp-1); }

table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
th {
  text-align: left;
  font-weight: 500;
  color: var(--text-3);
  font-size: var(--fs-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--border-1);
}
td { padding: var(--sp-3); border-bottom: 1px solid var(--border-1); }
tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--bg-subtle); }

button, .btn {
  appearance: none;
  border: 1px solid var(--border-2);
  background: var(--surface-2);
  color: var(--text-1);
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-4);
  font-size: var(--fs-sm);
  font-family: inherit;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

button:hover, .btn:hover { background: var(--bg-subtle); border-color: var(--text-3); }
button:focus-visible, .btn:focus-visible, input:focus-visible,
select:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

button.primary {
  background: var(--inverse-bg);
  color: var(--inverse-text);
  border-color: var(--inverse-bg);
  font-weight: 500;
}
button.primary:hover { background: var(--inverse-hover); border-color: var(--inverse-hover); }
button.ghost { background: transparent; border-color: var(--border-1); }
button:disabled { opacity: 0.5; cursor: not-allowed; }

input, select, textarea {
  width: 100%;
  background: var(--surface-2);
  border: 1px solid var(--border-2);
  border-radius: var(--r-md);
  color: var(--text-1);
  padding: var(--sp-2) var(--sp-3);
  font-size: var(--fs-sm);
  font-family: inherit;
}

textarea { min-height: 140px; resize: vertical; font-family: inherit; }
input::placeholder, textarea::placeholder { color: var(--text-3); }

.field { margin-bottom: var(--sp-4); }
.field label {
  display: block;
  font-size: var(--fs-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-3);
  margin-bottom: var(--sp-2);
}
.field .hint { color: var(--text-3); font-size: var(--fs-xs); margin-top: var(--sp-1); }

.row { display: flex; gap: var(--sp-3); flex-wrap: wrap; align-items: center; }
.row > * { flex: 1 1 200px; }
.row > .shrink { flex: 0 0 auto; }

.badge {
  display: inline-block;
  padding: 1px var(--sp-2);
  border-radius: var(--r-sm);
  font-size: var(--fs-xs);
  border: 1px solid var(--border-2);
  color: var(--text-2);
  white-space: nowrap;
}

.badge.ok { color: var(--ok); border-color: var(--ok); }
.badge.warn { color: var(--warn); border-color: var(--warn); background: var(--warn-bg); }
.badge.bad { color: var(--bad); border-color: var(--bad); background: var(--bad-bg); }

#toast {
  position: fixed;
  right: var(--sp-6);
  bottom: var(--sp-6);
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--r-md);
  padding: var(--sp-3) var(--sp-5);
  font-size: var(--fs-sm);
  max-width: 380px;
  display: none;
  z-index: 40;
}

#toast.show { display: block; }
#toast.error { border-color: var(--bad); color: var(--bad); }

.log-line {
  display: grid;
  grid-template-columns: 92px 64px 1fr;
  gap: var(--sp-3);
  padding: var(--sp-1) 0;
  border-bottom: 1px solid var(--border-1);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fs-xs);
}

.log-line .time { color: var(--text-3); }
.log-line .level { text-transform: uppercase; }
.log-line .level.debug { color: var(--text-3); }
.log-line .level.info { color: var(--text-1); }
.log-line .level.warn { color: var(--warn); }
.log-line .level.error { color: var(--bad); }
.log-line .message { color: var(--text-2); word-break: break-word; }

#login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-6);
}

#login .card { width: 100%; max-width: 380px; margin: 0; }
#login h1 { font-size: var(--fs-xl); margin-bottom: var(--sp-2); }
#login p { color: var(--text-3); font-size: var(--fs-sm); margin-bottom: var(--sp-5); }

.hidden { display: none !important; }

.bar {
  height: 6px;
  background: var(--surface-2);
  border-radius: 3px;
  overflow: hidden;
}
.bar > span { display: block; height: 100%; background: var(--text-2); }

.empty {
  color: var(--text-3);
  font-size: var(--fs-sm);
  padding: var(--sp-6);
  text-align: center;
}
`;

// src/webui/script-core.ts
var WEBUI_CORE = `
const state = { csrf: "", page: "overview", config: null, monitor: null };

const PAGES = [
  { group: "Monitor", id: "overview", label: "Overview" },
  { group: "Monitor", id: "models", label: "Models" },
  { group: "Monitor", id: "keys", label: "API Keys" },
  { group: "Monitor", id: "quota", label: "Quota" },
  { group: "Tools", id: "playground", label: "Playground" },
  { group: "Tools", id: "rotation", label: "Rotation" },
  { group: "Settings", id: "config", label: "Configuration" },
  { group: "Settings", id: "account", label: "Account" },
  { group: "Settings", id: "logs", label: "Logs" },
];

const el = (id) => document.getElementById(id);

function toast(message, isError) {
  const node = el("toast");
  node.textContent = message;
  node.className = "show" + (isError ? " error" : "");
  clearTimeout(node._timer);
  node._timer = setTimeout(() => { node.className = ""; }, 4000);
}

async function api(path, options) {
  const settings = Object.assign({ credentials: "same-origin" }, options || {});
  settings.headers = Object.assign(
    { "Content-Type": "application/json" },
    settings.headers || {},
  );
  if (state.csrf && settings.method && settings.method !== "GET") {
    settings.headers["X-CSRF-Token"] = state.csrf;
  }
  const response = await fetch(path, settings);
  if (response.status === 401) {
    showLogin();
    throw new Error("session expired");
  }
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const message = payload && payload.error
      ? payload.error.message
      : "request failed with HTTP " + response.status;
    throw new Error(message);
  }
  return payload;
}

function showLogin() {
  el("app").classList.add("hidden");
  el("login").classList.remove("hidden");
}

function showApp() {
  el("login").classList.add("hidden");
  el("app").classList.remove("hidden");
}

function renderNav() {
  const groups = [];
  for (const page of PAGES) {
    let group = groups.find((entry) => entry.name === page.group);
    if (!group) {
      group = { name: page.group, items: [] };
      groups.push(group);
    }
    group.items.push(page);
  }
  el("nav").innerHTML = groups.map((group) => (
    '<div class="nav-group"><h3>' + group.name + '</h3>' +
    group.items.map((page) => (
      '<a class="nav-item" data-page="' + page.id + '">' + page.label + '</a>'
    )).join("") +
    '</div>'
  )).join("");
  for (const node of document.querySelectorAll(".nav-item")) {
    node.addEventListener("click", () => {
      location.hash = "#" + node.dataset.page;
    });
  }
}

function markActive() {
  for (const node of document.querySelectorAll(".nav-item")) {
    node.classList.toggle("active", node.dataset.page === state.page);
  }
}

function fmt(n) {
  if (n === undefined || n === null) return "0";
  return Number(n).toLocaleString("en-US");
}

function pct(value) {
  return (Math.round(value * 1000) / 10).toFixed(1) + "%";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stat(label, value, sub) {
  return '<div class="stat"><div class="label">' + escapeHtml(label) +
    '</div><div class="value">' + escapeHtml(value) +
    '</div><div class="sub">' + escapeHtml(sub) + '</div></div>';
}
`;

// src/webui/script-monitor.ts
var WEBUI_MONITOR_PAGES = `
async function loadOverview() {
  const data = await api("/api/monitor");
  state.monitor = data;
  const metrics = data.metrics || {};
  const lifetime = metrics.lifetime || {};
  const window = metrics.last_hour || {};
  const usage = metrics.usage || {};
  const upstream = metrics.upstream || {};
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Overview</h1>' +
    '<p>Live traffic, token usage and upstream health</p></div></div>' +
    '<div class="grid">' +
    stat("Total requests", fmt(lifetime.total), fmt(lifetime.errors) + " errors") +
    stat("Success rate", pct(lifetime.success_rate || 0), "lifetime") +
    stat("Active requests", fmt(metrics.active_requests), fmt(metrics.active_streams) + " streaming") +
    stat("Uptime", formatUptime(metrics.uptime_seconds), "since start") +
    stat("Input tokens", fmt(usageLifetime(usage, "input_tokens")), "lifetime") +
    stat("Output tokens", fmt(usageLifetime(usage, "output_tokens")), "lifetime") +
    stat("Last hour", fmt(window.total), "requests") +
    stat("Upstream attempts", fmt((upstream.lifetime || {}).total), "total") +
    '</div>' +
    '<div class="card"><h2>Requests per minute</h2>' +
    seriesChart(metrics.series || []) +
    '</div>' +
    '<div class="card"><h2>Models</h2>' +
    countTable(metrics.models || {}) +
    '</div>' +
    '<div class="card"><h2>Recent upstream requests</h2>' +
    upstreamTable(upstream.requests || []) +
    '</div>'
  );
}

function usageLifetime(usage, field) {
  const lifetime = usage.lifetime || {};
  const tokens = lifetime.tokens || {};
  return tokens[field] || 0;
}

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return hours + "h " + minutes + "m";
  return minutes + "m " + (total % 60) + "s";
}

function seriesChart(series) {
  if (!series.length) return '<div class="empty">No traffic recorded yet</div>';
  const max = series.reduce((acc, point) => Math.max(acc, point.total), 0) || 1;
  const bars = series.slice(-30).map((point) => {
    const height = Math.round((point.total / max) * 100);
    const label = new Date(point.minute).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit",
    });
    return '<div title="' + escapeHtml(label) + ": " + point.total + " requests, " +
      point.errors + ' errors" style="flex:1 1 0;height:100%;display:flex;' +
      'flex-direction:column;justify-content:flex-end">' +
      '<div style="height:' + Math.max(height, 1) + '%;background:var(--text-2);' +
      'border-radius:2px 2px 0 0"></div></div>';
  }).join("");
  return '<div style="display:flex;align-items:flex-end;gap:2px;height:140px">' +
    bars + '</div>';
}

function countTable(counts) {
  const entries = Object.entries(counts || {});
  if (!entries.length) return '<div class="empty">No data yet</div>';
  entries.sort((a, b) => b[1] - a[1]);
  return '<table><thead><tr><th>Name</th><th>Count</th></tr></thead><tbody>' +
    entries.map(([name, count]) =>
      '<tr><td class="mono">' + escapeHtml(name) + '</td><td>' + fmt(count) + '</td></tr>'
    ).join("") + '</tbody></table>';
}

function upstreamTable(requests) {
  if (!requests.length) return '<div class="empty">No upstream requests yet</div>';
  return '<table><thead><tr><th>Time</th><th>Model</th><th>Tier</th>' +
    '<th>Status</th><th>Duration</th><th>Outcome</th></tr></thead><tbody>' +
    requests.slice().reverse().slice(0, 50).map((entry) =>
      '<tr><td class="mono">' + escapeHtml(new Date(entry.time).toLocaleTimeString()) +
      '</td><td class="mono">' + escapeHtml(entry.model) +
      '</td><td>' + escapeHtml(entry.tier || "-") +
      '</td><td>' + escapeHtml(entry.status) +
      '</td><td>' + fmt(entry.duration_ms) + " ms" +
      '</td><td>' + escapeHtml(entry.outcome || "-") + '</td></tr>'
    ).join("") + '</tbody></table>';
}

async function loadModels() {
  const data = await api("/api/debug/models");
  const models = data.models || [];
  const catalog = data.catalog || {};
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Models</h1>' +
    '<p>' + fmt(catalog.total) + " discovered, " + fmt(catalog.exposed) +
    " exposed" + (catalog.stale ? " (stale)" : "") + '</p></div></div>' +
    '<div class="card"><h2>Catalog</h2>' +
    '<div class="grid">' +
    stat("Zen models", fmt(catalog.zen), "") +
    stat("Go models", fmt(catalog.go), "") +
    stat("Total", fmt(catalog.total), "") +
    stat("Exposed", fmt(catalog.exposed), "") +
    '</div></div>' +
    '<div class="card"><h2>Routing</h2>' +
    modelsTable(models) +
    '</div>'
  );
}

function modelsTable(models) {
  if (!models.length) return '<div class="empty">No models discovered yet</div>';
  return '<table><thead><tr><th>Model</th><th>Protocol</th><th>Tier</th>' +
    '<th>Anonymous</th><th>Source</th><th>Error</th></tr></thead><tbody>' +
    models.map((entry) =>
      '<tr><td class="mono">' + escapeHtml(entry.model) +
      '</td><td>' + escapeHtml(entry.native_protocol || "-") +
      '</td><td>' + escapeHtml(entry.tier || "-") +
      '</td><td>' + (entry.anonymous ? "yes" : "no") +
      '</td><td>' + escapeHtml(entry.protocol_source || "-") +
      '</td><td>' + (entry.route_error
        ? '<span class="badge bad">' + escapeHtml(entry.route_error) + '</span>'
        : '<span class="badge ok">ok</span>') +
      '</td></tr>'
    ).join("") + '</tbody></table>';
}

async function loadKeys() {
  const data = await api("/api/api-keys");
  const keys = data.keys || [];
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>API Keys</h1>' +
    '<p>Local keys your clients authenticate with</p></div>' +
    '<button class="primary shrink" id="create-key">Create key</button></div>' +
    '<div class="card"><h2>Keys</h2>' + keysTable(keys) + '</div>'
  );
  el("create-key").addEventListener("click", createKey);
}

function keysTable(keys) {
  if (!keys.length) return '<div class="empty">No keys configured</div>';
  return '<table><thead><tr><th>Name</th><th>Value</th><th>State</th>' +
    '<th>Requests</th><th>Created</th><th></th></tr></thead><tbody>' +
    keys.map((entry) =>
      '<tr><td>' + escapeHtml(entry.name) +
      '</td><td class="mono">' + escapeHtml(entry.display) +
      '</td><td>' + (entry.enabled
        ? '<span class="badge ok">enabled</span>'
        : '<span class="badge bad">disabled</span>') +
      '</td><td>' + fmt((entry.usage || {}).lifetime
        ? entry.usage.lifetime.requests : 0) +
      '</td><td class="mono">' + escapeHtml(
        entry.created_at ? new Date(entry.created_at).toLocaleDateString() : "-") +
      '</td><td><button class="ghost" data-toggle="' + escapeHtml(entry.id) +
      '">Toggle</button> ' +
      '<button class="ghost" data-delete="' + escapeHtml(entry.id) +
      '">Delete</button></td></tr>'
    ).join("") + '</tbody></table>';
}

async function createKey() {
  const name = prompt("Name for the new API key");
  if (!name) return;
  try {
    const result = await api("/api/api-keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    toast("Key created: " + result.key);
    await loadKeys();
  } catch (error) {
    toast(error.message, true);
  }
}

async function loadQuota() {
  const data = await api("/api/model-quotas");
  const accounts = data.accounts || [];
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Quota</h1>' +
    '<p>' + escapeHtml(data.note || "") + '</p></div></div>' +
    '<div class="card"><h2>Accounts</h2>' + quotaTable(accounts) + '</div>'
  );
}

function quotaTable(accounts) {
  if (!accounts.length) return '<div class="empty">No Go keys configured</div>';
  return '<table><thead><tr><th>Key</th><th>Status</th><th>Window</th>' +
    '<th>Used</th></tr></thead><tbody>' +
    accounts.map((entry) => {
      const windows = entry.windows || {};
      const rows = Object.keys(windows).map((name) => {
        const win = windows[name] || {};
        return "<tr><td>" + escapeHtml(entry.display) + '</td><td>' +
          escapeHtml(entry.status) + '</td><td>' + escapeHtml(name) +
          '</td><td>' + pct(win.used_percent || 0) + '</td></tr>';
      }).join("");
      return rows || '<tr><td>' + escapeHtml(entry.display) +
        '</td><td>' + escapeHtml(entry.status) + '</td><td>-</td><td>-</td></tr>';
    }).join("") + '</tbody></table>';
}
`;

// src/webui/script-settings.ts
var WEBUI_SETTINGS_PAGES = `
async function loadPlayground() {
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Playground</h1>' +
    '<p>Send a test request through the proxy</p></div></div>' +
    '<div class="card"><h2>Request</h2>' +
    '<div class="row">' +
    '<div class="field"><label>Protocol</label><select id="pg-protocol">' +
    '<option value="chat">chat</option>' +
    '<option value="responses">responses</option>' +
    '<option value="anthropic">anthropic</option>' +
    '</select></div>' +
    '<div class="field"><label>Model</label><input id="pg-model" placeholder="model id"></div>' +
    '</div>' +
    '<div class="field"><label>Body</label><textarea id="pg-body">' +
    '{"model":"","messages":[{"role":"user","content":"Hello"}]}' +
    '</textarea><div class="hint">The model field is filled in from the box above.</div></div>' +
    '<button class="primary" id="pg-send">Send request</button>' +
    '</div>' +
    '<div class="card"><h2>Response</h2><pre id="pg-result" class="mono">' +
    'No request sent yet.</pre></div>'
  );
  el("pg-send").addEventListener("click", sendPlayground);
}

async function sendPlayground() {
  const protocol = el("pg-protocol").value;
  const model = el("pg-model").value.trim();
  let body;
  try {
    body = JSON.parse(el("pg-body").value);
  } catch {
    toast("The body must be valid JSON", true);
    return;
  }
  body.model = model;
  el("pg-result").textContent = "Sending...";
  try {
    const result = await api("/api/debug/inference", {
      method: "POST",
      body: JSON.stringify({ protocol, request: body }),
    });
    el("pg-result").textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    el("pg-result").textContent = error.message;
    toast(error.message, true);
  }
}

async function loadRotation() {
  const data = await api("/api/rotation");
  const groups = data.groups || [];
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Rotation</h1>' +
    '<p>Model groups that rotate between upstreams</p></div></div>' +
    groups.map((group) => (
      '<div class="card"><h2>' + escapeHtml(group.alias || group.id) +
      ' <span class="badge">current: ' + escapeHtml(group.current || "-") +
      '</span></h2>' +
      '<table><thead><tr><th>Model</th><th>State</th><th></th></tr></thead><tbody>' +
      (group.order || []).map((model) => (
        '<tr><td class="mono">' + escapeHtml(model) + '</td><td>' +
        (group.current === model
          ? '<span class="badge ok">current</span>'
          : '<span class="badge">idle</span>') +
        '</td><td><button class="ghost" data-group="' + escapeHtml(group.id) +
        '" data-model="' + escapeHtml(model) + '">Use</button></td></tr>'
      )).join("") + '</tbody></table></div>'
    )).join("")
  );
  for (const button of document.querySelectorAll("[data-group]")) {
    button.addEventListener("click", () => selectRotation(
      button.dataset.group, button.dataset.model));
  }
}

async function selectRotation(group, model) {
  try {
    await api("/api/rotation/current", {
      method: "POST",
      body: JSON.stringify({ group, model }),
    });
    toast("Switched to " + model);
    await loadRotation();
  } catch (error) {
    toast(error.message, true);
  }
}

async function loadConfig() {
  const config = await api("/api/config");
  state.config = config;
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Configuration</h1>' +
    '<p>Upstream lanes, retries and server behavior</p></div>' +
    '<button class="primary shrink" id="save-config">Save</button></div>' +
    '<div class="card"><h2>Upstream</h2>' +
    '<div class="field"><label>Zen base URL</label>' +
    '<input id="cfg-zen" value="' + escapeHtml(config.upstream.zen) + '"></div>' +
    '<div class="field"><label>Go base URL</label>' +
    '<input id="cfg-go" value="' + escapeHtml(config.upstream.go) + '"></div>' +
    '<div class="field"><label>Anonymous base URL</label>' +
    '<input id="cfg-anon" value="' + escapeHtml(config.upstream.anonymous || "") + '">' +
    '</div></div>' +
    '<div class="card"><h2>Behavior</h2><div class="row">' +
    '<div class="field"><label>Prefer tier</label><select id="cfg-prefer">' +
    '<option value="go"' + (config.prefer === "go" ? " selected" : "") + '>go</option>' +
    '<option value="zen"' + (config.prefer === "zen" ? " selected" : "") + '>zen</option>' +
    '</select></div>' +
    '<div class="field"><label>Max attempts</label><input id="cfg-attempts" type="number" value="' +
    escapeHtml(config.retry.max_attempts) + '"></div>' +
    '<div class="field"><label>Timeout (seconds)</label><input id="cfg-timeout" type="number" value="' +
    escapeHtml(config.retry.timeout_seconds) + '"></div>' +
    '<div class="field"><label>Catalog refresh (seconds)</label>' +
    '<input id="cfg-refresh" type="number" value="' +
    escapeHtml(config.models.refresh_seconds) + '"></div>' +
    '</div>' +
    '<div class="row"><div class="field"><label>Log level</label><select id="cfg-level">' +
    ["debug", "info", "warn", "error"].map((level) =>
      '<option value="' + level + '"' +
      (config.logging.level === level ? " selected" : "") + '>' + level + '</option>'
    ).join("") + '</select></div>' +
    '<div class="field"><label>Log ring size</label><input id="cfg-ring" type="number" value="' +
    escapeHtml(config.logging.ring_size) + '"></div></div>' +
    '<div class="field"><label>Free models only</label>' +
    '<select id="cfg-freeonly"><option value="false"' +
    (!config.models.free_only ? " selected" : "") + '>no</option>' +
    '<option value="true"' + (config.models.free_only ? " selected" : "") +
    '>yes</option></select></div></div>' +
    (config.restart_required_fields && config.restart_required_fields.length
      ? '<div class="card"><span class="badge warn">Restart required: ' +
        escapeHtml(config.restart_required_fields.join(", ")) + '</span></div>'
      : "")
  );
  el("save-config").addEventListener("click", saveConfig);
}

async function saveConfig() {
  const config = state.config;
  const body = JSON.parse(JSON.stringify(config));
  body.upstream.zen = el("cfg-zen").value.trim();
  body.upstream.go = el("cfg-go").value.trim();
  body.upstream.anonymous = el("cfg-anon").value.trim();
  body.prefer = el("cfg-prefer").value;
  body.retry.max_attempts = Number(el("cfg-attempts").value);
  body.retry.timeout_seconds = Number(el("cfg-timeout").value);
  body.models.refresh_seconds = Number(el("cfg-refresh").value);
  body.models.free_only = el("cfg-freeonly").value === "true";
  body.logging.level = el("cfg-level").value;
  body.logging.ring_size = Number(el("cfg-ring").value);
  delete body.effective;
  delete body.restart_required_fields;
  try {
    await api("/api/config", { method: "PUT", body: JSON.stringify(body) });
    toast("Configuration saved");
    await loadConfig();
  } catch (error) {
    toast(error.message, true);
  }
}

async function loadAccount() {
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Account</h1>' +
    '<p>Change the WebUI credentials</p></div></div>' +
    '<div class="card"><h2>Credentials</h2>' +
    '<div class="field"><label>Current password</label>' +
    '<input id="acc-current" type="password"></div>' +
    '<div class="field"><label>New username</label>' +
    '<input id="acc-username" placeholder="leave empty to keep"></div>' +
    '<div class="field"><label>New password</label>' +
    '<input id="acc-password" type="password" placeholder="leave empty to keep"></div>' +
    '<button class="primary" id="acc-save">Update</button></div>'
  );
  el("acc-save").addEventListener("click", saveAccount);
}

async function saveAccount() {
  const body = {
    current_password: el("acc-current").value,
    username: el("acc-username").value.trim(),
    new_password: el("acc-password").value,
  };
  try {
    await api("/api/account", { method: "PUT", body: JSON.stringify(body) });
    toast("Account updated, please sign in again");
    showLogin();
  } catch (error) {
    toast(error.message, true);
  }
}

let logSource = null;

async function loadLogs() {
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Logs</h1>' +
    '<p>Live structured log stream</p></div></div>' +
    '<div class="card"><h2>Stream</h2><div id="log-lines"></div></div>'
  );
  if (logSource) { logSource.close(); logSource = null; }
  const source = new EventSource("/api/logs/stream");
  logSource = source;
  source.addEventListener("log", (event) => {
    const entry = JSON.parse(event.data);
    const container = el("log-lines");
    if (!container) return;
    const line = document.createElement("div");
    line.className = "log-line";
    line.innerHTML = '<span class="time">' +
      escapeHtml(new Date(entry.time).toLocaleTimeString()) +
      '</span><span class="level ' + escapeHtml(entry.level) + '">' +
      escapeHtml(entry.level) + '</span><span class="message">' +
      escapeHtml(entry.message) +
      (entry.component ? ' [' + escapeHtml(entry.component) + ']' : "") +
      '</span>';
    container.prepend(line);
    while (container.children.length > 500) {
      container.removeChild(container.lastChild);
    }
  });
  source.addEventListener("gap", () => {
    toast("Some log events were skipped", true);
  });
}

const LOADERS = {
  overview: loadOverview,
  models: loadModels,
  keys: loadKeys,
  quota: loadQuota,
  playground: loadPlayground,
  rotation: loadRotation,
  config: loadConfig,
  account: loadAccount,
  logs: loadLogs,
};

async function render() {
  const hash = location.hash.replace("#", "") || "overview";
  state.page = LOADERS[hash] ? hash : "overview";
  markActive();
  try {
    await LOADERS[state.page]();
  } catch (error) {
    el("content").innerHTML = '<div class="empty">' +
      escapeHtml(error.message) + '</div>';
  }
}

async function login(event) {
  event.preventDefault();
  const username = el("login-user").value;
  const password = el("login-pass").value;
  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    state.csrf = result.csrf_token;
    showApp();
    await render();
  } catch (error) {
    toast(error.message, true);
  }
}

async function boot() {
  renderNav();
  window.addEventListener("hashchange", render);
  el("login-form").addEventListener("submit", login);
  try {
    const session = await api("/api/auth/session");
    state.csrf = session.csrf_token;
    showApp();
    await render();
  } catch {
    showLogin();
  }
}

boot();
`;

// src/webui/document.ts
var WEBUI_SCRIPT = `${WEBUI_CORE}${WEBUI_MONITOR_PAGES}${WEBUI_SETTINGS_PAGES}`;
var WEBUI_BODY = `
<div id="login" class="hidden">
  <div class="card">
    <h1>OpenCode2API</h1>
    <p>Sign in to the control panel.</p>
    <form id="login-form">
      <div class="field">
        <label for="login-user">Username</label>
        <input id="login-user" value="admin" autocomplete="username">
      </div>
      <div class="field">
        <label for="login-pass">Password</label>
        <input id="login-pass" type="password" autocomplete="current-password">
      </div>
      <button class="primary" type="submit" style="width:100%">Sign in</button>
    </form>
  </div>
</div>

<div id="app" class="hidden">
  <div id="layout">
    <aside id="sidebar">
      <div id="brand"><span class="dot"></span>OpenCode2API</div>
      <nav id="nav"></nav>
    </aside>
    <main id="content"></main>
  </div>
</div>

<div id="toast"></div>
`;
function buildWebUIHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>OpenCode2API Control Panel</title>
<style>
${THEME_TOKENS}
${WEBUI_STYLES}
</style>
</head>
<body>
${WEBUI_BODY}
<script>
${WEBUI_SCRIPT}
</script>
</body>
</html>
`;
}
var WEBUI_HTML = buildWebUIHTML();

// src/protocol/anthropic-betas.ts
var TOOL_BETAS = {
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
  advisor_20260301: "advisor-tool-2026-03-01"
};
var CLAUDE_3_OR_OLDER = /claude-(?:instant(?:-|$)|v?2(?:$|[-.:])|3(?:$|[-.]))/;
var STRUCTURED_OUTPUT_MODELS = [
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
  "claude-sonnet-4-1"
];
function v1AnthropicBetas(body) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return "";
  }
  if (!isPlainObject(payload)) {
    return "";
  }
  const betas = [];
  const add = (beta) => {
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
      if (isPresentJSON(tool["input_examples"]) || isPresentJSON(tool["allowed_callers"])) {
        add("advanced-tool-use-2025-11-20");
      }
      continue;
    }
    const beta = TOOL_BETAS[type];
    if (beta !== void 0) {
      add(beta);
    }
  }
  return betas.join(",");
}
function isPresentJSON(value) {
  return value !== void 0 && value !== null;
}
function anthropicSupportsStructuredOutput(model) {
  for (const supported of STRUCTURED_OUTPUT_MODELS) {
    if (model.includes(supported)) {
      return true;
    }
  }
  if (model.includes("claude-sonnet-4-") || model.includes("claude-opus-4-") || model.includes("claude-3-haiku") || CLAUDE_3_OR_OLDER.test(model)) {
    return false;
  }
  return model.includes("claude-");
}

// src/protocol/upstream-headers.ts
var V2_ANTHROPIC_BETAS = "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14";
var GIT_COMMIT = /^[0-9a-f]{40}$/;
function v1ProjectID(project) {
  if (project === "global" || GIT_COMMIT.test(project)) {
    return project;
  }
  return v2ProjectID(project);
}
function v2ProjectID(project) {
  const sum = sha256Bytes(`opencode-project\0${project}`);
  return toHex(sum.subarray(0, 20));
}
function setV1Headers(headers, protocol, body, ids) {
  headers.set("Accept", "*/*");
  headers.set("User-Agent", v1UserAgent(v1ProviderUtils(protocol)));
  headers.set("x-opencode-client", "cli");
  headers.set("x-opencode-session", ids.session);
  headers.set("x-opencode-session-id", ids.session);
  headers.set("x-opencode-request", ids.message);
  headers.set("x-opencode-project", v1ProjectID(ids.project));
  if (ids.parentSession !== "") {
    const parent = canonicalSessionID(ids.parentSession);
    headers.set("x-opencode-parent-session-id", parent);
    headers.set("x-parent-session-id", parent);
  }
  if (protocol === "anthropic") {
    const betas = v1AnthropicBetas(body);
    if (betas !== "") {
      headers.set("anthropic-beta", betas);
    }
  }
}
function setV2Headers(headers, protocol, ids) {
  headers.set("Accept", "application/json, text/event-stream");
  headers.set("x-opencode-client", "cli");
  headers.set("x-opencode-session", ids.session);
  headers.set("x-session-affinity", ids.session);
  headers.set("X-Session-Id", ids.session);
  headers.set("User-Agent", V2_USER_AGENT);
  headers.set("x-opencode-session-id", ids.session);
  headers.set("x-opencode-project", v2ProjectID(ids.project));
  if (ids.parentSession !== "") {
    headers.set("x-parent-session-id", ids.parentSession);
  }
  if (protocol === "anthropic") {
    headers.set("anthropic-beta", V2_ANTHROPIC_BETAS);
  }
}

// src/protocol/upstream-request.ts
function buildUpstreamRequest(baseURL, protocol, body, ids, key) {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  if (isV1Upstream(baseURL)) {
    setV1Headers(headers, protocol, body, ids);
  } else {
    setV2Headers(headers, protocol, ids);
  }
  if (protocol === "anthropic") {
    headers.set("x-api-key", key);
    headers.set("anthropic-version", "2023-06-01");
  } else {
    headers.set("Authorization", `Bearer ${key}`);
  }
  return { url: upstreamURL(baseURL, protocol), headers, body };
}

// src/worker/unlimited.ts
var DEFAULT_ZEN = "https://opencode.ai/zen";
var DEFAULT_GO = "https://opencode.ai/zen/go";
var DEFAULT_ANONYMOUS = "https://opencode.ai/inference";
var ANONYMOUS_TOKEN = "public";
var workerGuardInstance;
function getWorkerGuard() {
  if (workerGuardInstance === void 0) {
    workerGuardInstance = new UnlimitedGuard(DEFAULT_AAAA_POOL, "worker");
  }
  return workerGuardInstance;
}
async function handleWorkerDoctor(fetchImpl = fetch) {
  const guard = getWorkerGuard();
  const pool = await resolveEdgePool(fetchImpl);
  guard.setPool(pool);
  return buildDoctorReport(guard, fetchImpl, "cloudflare-worker");
}
async function handleWorkerHop(fetchImpl = fetch) {
  const guard = getWorkerGuard();
  const oldEdge = guard.current().edge;
  const pool = await resolveEdgePool(fetchImpl);
  guard.setPool(pool);
  const rotated = guard.hop(pool, true);
  const snap = guard.snapshot();
  return {
    status: "rotated",
    old_edge: oldEdge,
    new_edge: rotated.edge,
    prefix64: rotated.prefix64,
    session: rotated.ids.session,
    machine_id: rotated.machineId,
    hops: snap.hops,
    blacklisted_count: snap.blacklist.length
  };
}
function collectCandidates(env, requestedModel = "") {
  const goKeys = parseKeys(env.OPENCODE_GO_KEYS);
  const zenKeys = parseKeys(env.OPENCODE_ZEN_KEYS);
  const goBase = env.UPSTREAM_GO ?? DEFAULT_GO;
  const zenBase = env.UPSTREAM_ZEN ?? DEFAULT_ZEN;
  const anonBase = env.UPSTREAM_ANONYMOUS ?? DEFAULT_ANONYMOUS;
  const kiloBase = env.UPSTREAM_KILO ?? KILO_GATEWAY_BASE;
  const candidates = [];
  for (const key of goKeys) {
    candidates.push({ kind: "opencode", baseURL: goBase, key });
  }
  for (const key of zenKeys) {
    candidates.push({ kind: "opencode", baseURL: zenBase, key });
  }
  const ocModel = requestedModel !== "" ? resolveOpenCodeFreeModel(requestedModel) : void 0;
  const kiloModels = kiloFallbackChain(requestedModel || "beam-free");
  if (requestedModel !== "" && isKiloModelId(requestedModel)) {
    for (const kiloModel of kiloModels) {
      candidates.push({
        kind: "kilo",
        baseURL: kiloBase,
        key: KILO_ANONYMOUS_TOKEN,
        modelOverride: kiloModel
      });
    }
  }
  candidates.push({
    kind: "opencode",
    baseURL: anonBase,
    key: ANONYMOUS_TOKEN,
    modelOverride: ocModel
  });
  for (const kiloModel of kiloModels) {
    candidates.push({
      kind: "kilo",
      baseURL: kiloBase,
      key: KILO_ANONYMOUS_TOKEN,
      modelOverride: kiloModel
    });
  }
  if (anonBase.replace(/\/+$/, "").toLowerCase() !== zenBase.replace(/\/+$/, "").toLowerCase()) {
    candidates.push({
      kind: "opencode",
      baseURL: zenBase,
      key: ANONYMOUS_TOKEN,
      modelOverride: ocModel
    });
  }
  return candidates;
}
function parseKeys(value) {
  if (value === void 0) {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter((item) => item !== "");
}
async function forwardWithUnlimitedGuard(env, protocol, payload, initialIDs, corsHeaders, fetchImpl = fetch) {
  const guard = getWorkerGuard();
  const requestedModel = typeof payload["model"] === "string" ? payload["model"] : "beam-free";
  const clientWantsStream = boolAt(payload, "stream") === true;
  const candidates = collectCandidates(env, requestedModel);
  const guarded = await guard.executeWithGuard(async (lane, attempt) => {
    const activeIDs = attempt === 1 ? initialIDs : lane.ids;
    const candidate = candidates[(attempt - 1) % candidates.length] ?? {
      kind: "opencode",
      baseURL: DEFAULT_ANONYMOUS,
      key: ANONYMOUS_TOKEN
    };
    const { request, upstreamProtocol, alias } = prepareCandidateRequest(
      candidate,
      protocol,
      payload,
      activeIDs,
      clientWantsStream
    );
    const init = candidate.kind === "opencode" ? buildEdgeFetchInit(
      { method: "POST", headers: request.headers, body: request.body },
      lane.edge
    ) : { method: "POST", headers: request.headers, body: request.body };
    const response2 = await fetchImpl(request.url, init);
    if (response2.status >= 200 && response2.status < 300) {
      const normalized = await normalizeUnlimitedResponse(
        response2,
        upstreamProtocol,
        protocol,
        requestedModel,
        alias,
        clientWantsStream
      );
      return {
        status: normalized.status,
        bodyPreview: "",
        value: { response: normalized, ids: activeIDs, edge: lane.edge }
      };
    }
    const errorText = await response2.text();
    const shouldRotate = isQuotaWall(response2.status, errorText) || candidate.key === ANONYMOUS_TOKEN && (response2.status === 400 || response2.status === 401 || response2.status === 403 || response2.status === 404);
    const rebuilt = new Response(errorText, {
      status: response2.status,
      headers: response2.headers
    });
    return {
      status: shouldRotate ? 429 : response2.status,
      bodyPreview: shouldRotate ? errorText || "QuotaExceeded" : errorText,
      value: { response: rebuilt, ids: activeIDs, edge: lane.edge }
    };
  });
  const { response, ids, edge } = guarded.value;
  const headers = new Headers(response.headers);
  headers.set("x-request-id", ids.request);
  headers.set("x-opencode-edge", edge);
  headers.set("x-opencode-hops", String(guard.snapshot().hops));
  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}
function prepareCandidateRequest(candidate, protocol, payload, ids, clientWantsStream) {
  if (candidate.kind === "kilo") {
    const kiloModel = candidate.modelOverride ?? "reflection/beam-free";
    return {
      request: buildKiloUpstreamRequest(
        kiloModel,
        protocol,
        payload,
        clientWantsStream,
        candidate.baseURL
      ),
      upstreamProtocol: "chat",
      alias: ""
    };
  }
  const effectivePayload = candidate.modelOverride !== void 0 && candidate.key === ANONYMOUS_TOKEN ? { ...payload, model: candidate.modelOverride } : payload;
  const rawBody = JSON.stringify(effectivePayload);
  const shaped = prepareAnonymousBody(
    rawBody,
    protocol,
    isV1Upstream(candidate.baseURL)
  );
  return {
    request: buildUpstreamRequest(
      candidate.baseURL,
      protocol,
      shaped.body,
      ids,
      candidate.key
    ),
    upstreamProtocol: protocol,
    alias: shaped.alias
  };
}

// src/worker/index.ts
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, x-opencode-session, x-opencode-session-id, x-session-affinity, x-session-id, x-opencode-request, x-opencode-project, x-parent-session-id, x-opencode-client, Accept",
  "Access-Control-Expose-Headers": "x-request-id, x-opencode-edge, x-opencode-hops",
  "Access-Control-Max-Age": "86400"
};
var DEFAULT_ZEN2 = "https://opencode.ai/zen";
var DEFAULT_GO2 = "https://opencode.ai/zen/go";
var ANONYMOUS_CREDENTIAL = "public";
var index_default = {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      return jsonResponse(
        {
          error: {
            message: error instanceof Error ? error.message : "internal error",
            type: "server_error",
            param: null,
            code: null
          }
        },
        500
      );
    }
  }
};
async function handle(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    if (!webuiEnabled(env)) {
      return jsonResponse({ error: { message: "not found" } }, 404);
    }
    return new Response(WEBUI_HTML, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...CORS_HEADERS
      }
    });
  }
  if (url.pathname === "/v1/health" || url.pathname === "/healthz") {
    return jsonResponse({ status: "ok", version: "dev" });
  }
  if (url.pathname === "/v1/unlimited/doctor" && request.method === "GET") {
    if (!authorized(request, env)) {
      return unauthorized();
    }
    return jsonResponse(await handleWorkerDoctor());
  }
  if (url.pathname === "/v1/unlimited/hop" && request.method === "POST") {
    if (!authorized(request, env)) {
      return unauthorized();
    }
    return jsonResponse(await handleWorkerHop());
  }
  if (url.pathname === "/v1/models") {
    if (!authorized(request, env)) {
      return unauthorized();
    }
    return modelsResponse(env);
  }
  const protocol = protocolFor(url.pathname);
  if (protocol === void 0) {
    return jsonResponse({ error: { message: "not found" } }, 404);
  }
  if (!authorized(request, env)) {
    return unauthorized();
  }
  const text = await request.text();
  let payload;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return errorResponse(protocol, 400, "request body must be a JSON object", "invalid_request_error");
    }
    payload = parsed;
  } catch {
    return errorResponse(protocol, 400, "request body must be a JSON object", "invalid_request_error");
  }
  const model = typeof payload["model"] === "string" ? payload["model"] : "";
  if (model === "") {
    return errorResponse(protocol, 400, "model is required", "invalid_request_error");
  }
  const ids = deriveRequestIDs(
    headersToDict(request.headers),
    payload,
    "worker"
  );
  return forwardWithUnlimitedGuard(env, protocol, payload, ids, CORS_HEADERS);
}
function pickTier(env) {
  if (firstKey(env.OPENCODE_GO_KEYS) !== "") {
    return "go";
  }
  return "zen";
}
function baseURLFor(env, tier) {
  if (tier === "go") {
    return env.UPSTREAM_GO ?? DEFAULT_GO2;
  }
  return env.UPSTREAM_ZEN ?? DEFAULT_ZEN2;
}
function firstKey(value) {
  if (value === void 0) {
    return "";
  }
  for (const part of value.split(",")) {
    const key = part.trim();
    if (key !== "") {
      return key;
    }
  }
  return "";
}
function authorized(request, env) {
  const expected = env.API_KEY ?? "";
  if (expected === "") {
    return true;
  }
  const header = request.headers.get("x-api-key");
  if (header !== null && constantTimeStringEquals(header, expected)) {
    return true;
  }
  const authorization = request.headers.get("authorization");
  if (authorization === null) {
    return false;
  }
  return authorization.toLowerCase().startsWith("bearer ") && constantTimeStringEquals(authorization.slice(7).trim(), expected);
}
function constantTimeStringEquals(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}
function webuiEnabled(env) {
  return (env.WEBUI_ENABLED ?? "true").toLowerCase() !== "false";
}
async function modelsResponse(env) {
  const tier = pickTier(env);
  const baseURL = baseURLFor(env, tier);
  const configuredKey = tier === "go" ? firstKey(env.OPENCODE_GO_KEYS) : firstKey(env.OPENCODE_ZEN_KEYS);
  const key = configuredKey !== "" ? configuredKey : ANONYMOUS_CREDENTIAL;
  const seen = new Set(BUILTIN_FREE_MODELS);
  try {
    const response = await fetch(`${baseURL.replace(/\/+$/, "")}/v1/models`, {
      headers: {
        Authorization: `Bearer ${key}`,
        "User-Agent": V2_USER_AGENT,
        "x-opencode-client": "cli"
      }
    });
    if (response.ok) {
      const payload = await response.json();
      const rawData = Array.isArray(payload["data"]) ? payload["data"] : [];
      for (const item of rawData) {
        if (typeof item === "object" && item !== null) {
          const id = item["id"];
          if (typeof id === "string" && id.trim() !== "") {
            seen.add(id.trim());
          }
        }
      }
    }
  } catch {
  }
  const data = [...seen].map((id) => ({
    id,
    object: "model",
    created: 0,
    owned_by: id.includes("/") ? "kilo" : "opencode"
  }));
  return jsonResponse({ object: "list", data });
}
function protocolFor(path) {
  switch (path) {
    case "/v1/chat/completions":
      return "chat";
    case "/v1/responses":
      return "responses";
    case "/v1/messages":
      return "anthropic";
    case "/v1/systemone":
      return "systemone";
    default:
      return void 0;
  }
}
function headersToDict(headers) {
  const result = {};
  headers.forEach((value, name) => {
    result[name] = value;
  });
  return result;
}
function jsonResponse(body, status = 200) {
  return new Response(`${JSON.stringify(body)}
`, {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS
    }
  });
}
function unauthorized() {
  return jsonResponse(
    {
      error: {
        message: "invalid API key",
        type: "authentication_error",
        param: null,
        code: null
      }
    },
    401
  );
}
function errorResponse(protocol, status, message, kind) {
  const envelope = buildErrorEnvelope(protocol, status, message, kind);
  return jsonResponse(envelope.body, envelope.status);
}
export {
  canonicalSessionID,
  index_default as default,
  randomID
};
