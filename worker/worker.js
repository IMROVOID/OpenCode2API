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
function randomID(prefix, size) {
  return `${prefix}_${toHex(randomBytes(size))}`;
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
function firstString(...values) {
  for (const value of values) {
    if (value) {
      return value.trim();
    }
  }
  return "";
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
var V2_USER_AGENT = "opencode/latest/2.0.32/cli";
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
  return baseURL.replace(/\/+$/, "") + protocolPath(protocol);
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
      function: { name, description, parameters }
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
  const raw = payload.tools;
  if (raw === void 0) {
    payload.tools = v2Toolset(protocol);
    return true;
  }
  if (!Array.isArray(raw)) {
    return false;
  }
  const items = raw;
  let changed = false;
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
    session: canonicalSessionID(seed),
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

// src/worker/unlimited.ts
var DEFAULT_ZEN = "https://opencode.ai/zen";
var DEFAULT_GO = "https://opencode.ai/zen/go";
var DEFAULT_ANONYMOUS = "https://opencode.ai/inference";
var ANONYMOUS_TOKEN = "public";
var workerGuard = new UnlimitedGuard(DEFAULT_AAAA_POOL, "worker");
async function handleWorkerDoctor(fetchImpl = fetch) {
  const pool = await resolveEdgePool(fetchImpl);
  workerGuard.setPool(pool);
  return buildDoctorReport(workerGuard, fetchImpl, "cloudflare-worker");
}
async function handleWorkerHop(fetchImpl = fetch) {
  const oldEdge = workerGuard.current().edge;
  const pool = await resolveEdgePool(fetchImpl);
  workerGuard.setPool(pool);
  const rotated = workerGuard.hop(pool, true);
  const snap = workerGuard.snapshot();
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
function collectCandidates(env) {
  const goKeys = parseKeys(env.OPENCODE_GO_KEYS);
  const zenKeys = parseKeys(env.OPENCODE_ZEN_KEYS);
  const goBase = env.UPSTREAM_GO ?? DEFAULT_GO;
  const zenBase = env.UPSTREAM_ZEN ?? DEFAULT_ZEN;
  const anonBase = env.UPSTREAM_ANONYMOUS ?? DEFAULT_ANONYMOUS;
  const candidates = [];
  for (const key of goKeys) {
    candidates.push({ baseURL: goBase, key });
  }
  for (const key of zenKeys) {
    candidates.push({ baseURL: zenBase, key });
  }
  candidates.push({ baseURL: zenBase, key: ANONYMOUS_TOKEN });
  if (anonBase.replace(/\/+$/, "").toLowerCase() !== zenBase.replace(/\/+$/, "").toLowerCase()) {
    candidates.push({ baseURL: anonBase, key: ANONYMOUS_TOKEN });
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
  const candidates = collectCandidates(env);
  const rawBody = JSON.stringify(payload);
  const guarded = await workerGuard.executeWithGuard(async (lane, attempt) => {
    const activeIDs = attempt === 1 ? initialIDs : lane.ids;
    const candidate = candidates[(attempt - 1) % candidates.length] ?? {
      baseURL: DEFAULT_ZEN,
      key: ANONYMOUS_TOKEN
    };
    const shaped = prepareAnonymousBody(
      rawBody,
      protocol,
      isV1Upstream(candidate.baseURL)
    );
    const upstream = buildUpstreamRequest(
      candidate.baseURL,
      protocol,
      shaped.body,
      activeIDs,
      candidate.key
    );
    upstream.headers.set("x-opencode-machine-id", lane.machineId);
    const init = buildEdgeFetchInit(
      {
        method: "POST",
        headers: upstream.headers,
        body: upstream.body
      },
      lane.edge
    );
    const response2 = await fetchImpl(upstream.url, init);
    if (response2.status >= 200 && response2.status < 300) {
      return {
        status: response2.status,
        bodyPreview: "",
        value: { response: response2, ids: activeIDs, edge: lane.edge }
      };
    }
    const errorText = await response2.text();
    const rebuilt = new Response(errorText, {
      status: response2.status,
      headers: response2.headers
    });
    return {
      status: response2.status,
      bodyPreview: isQuotaWall(response2.status, errorText) ? errorText || "QuotaExceeded" : errorText,
      value: { response: rebuilt, ids: activeIDs, edge: lane.edge }
    };
  });
  const { response, ids, edge } = guarded.value;
  const headers = new Headers(response.headers);
  headers.set("x-request-id", ids.request);
  headers.set("x-opencode-edge", edge);
  headers.set("x-opencode-hops", String(workerGuard.snapshot().hops));
  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
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
  try {
    const response = await fetch(`${baseURL.replace(/\/+$/, "")}/v1/models`, {
      headers: {
        Authorization: `Bearer ${key}`,
        "User-Agent": "opencode/latest/2.0.32/cli",
        "x-opencode-client": "cli"
      }
    });
    if (!response.ok) {
      return jsonResponse({ error: { message: "models endpoint failed" } }, 502);
    }
    const payload = await response.json();
    return jsonResponse(payload);
  } catch {
    return jsonResponse({ error: { message: "models endpoint unreachable" } }, 502);
  }
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
