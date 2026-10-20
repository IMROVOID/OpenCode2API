import type { Protocol } from "../types/config.js";
import { sha256Bytes, toHex } from "./sha256.js";
import type { RequestIDs } from "./identity.js";
import { canonicalSessionID } from "./identity.js";
import { v1AnthropicBetas } from "./anthropic-betas.js";
import { V2_USER_AGENT, v1ProviderUtils, v1UserAgent } from "./lanes.js";

// The v2 lane's fixed Anthropic beta set.
const V2_ANTHROPIC_BETAS =
  "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14";

const GIT_COMMIT = /^[0-9a-f]{40}$/;

// v1ProjectID renders the project header the way the OpenCode 1.x client does:
// the git root commit hash of the project, or "global" outside a git
// repository. A genuine value from a v1 client is kept verbatim; any other
// project is hashed into the commit shape.
export function v1ProjectID(project: string): string {
  if (project === "global" || GIT_COMMIT.test(project)) {
    return project;
  }
  return v2ProjectID(project);
}

// v2ProjectID renders the project header in the shape the OpenCode 2.x CLI
// sends to the v2 gates: a bare 40-character lowercase hex id. The value
// itself is not checked upstream, only its shape, but hashing keeps one
// project mapped to one stable upstream project id.
export function v2ProjectID(project: string): string {
  const sum = sha256Bytes(`opencode-project\0${project}`);
  return toHex(sum.subarray(0, 20));
}

// setV1Headers renders the v1 lane's header set, that of an OpenCode 1.19.3
// model request on its opencode provider: the AI SDK User-Agent of the
// package serving the protocol, both session headers, the user message id as
// x-opencode-request, the git root commit as the project, and the canonical
// parent session under both parent headers. The v1 client sends no
// x-session-affinity or X-Session-Id to this provider.
export function setV1Headers(
  headers: Headers,
  protocol: Protocol,
  body: string,
  ids: RequestIDs,
): void {
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

// setV2Headers renders the OpenCode 2.x CLI header set the v2 gates
// fingerprint: the "opencode/<channel>/<version>/cli" User-Agent, every
// session header set to the same descending-encoded id, and a bare
// 40-character hex x-opencode-project. The v2 gate rejects x-opencode-request
// and canonical prj_* project ids with 403 FreeTierError, so neither is sent.
export function setV2Headers(
  headers: Headers,
  protocol: Protocol,
  ids: RequestIDs,
): void {
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
