import type { Protocol, Tier } from "../types/config.js";
import { V1_BASE } from "../config/defaults.js";
import { protocolPath } from "./paths.js";

// The user agents the upstream gates fingerprint. The v1 lane reports the AI
// SDK package that serves the protocol, the v2 lane reports the CLI.
export const V2_USER_AGENT = "opencode/latest/2.2.5/cli";

export const V1_RESPONSES_SDK = "4.0.40";
export const V1_ANTHROPIC_SDK = "4.0.46";
export const V1_CHAT_SDK = "4.0.23";

// isV1Upstream reports whether a base URL is the v1 lane. The v1 lane serves
// the OpenCode 1.x request shape, so its headers and body gates differ from
// the v2 lane's.
export function isV1Upstream(baseURL: string): boolean {
  const normalized = baseURL.trim().toLowerCase().replace(/\/+$/, "");
  return normalized === V1_BASE || normalized.endsWith("/zen");
}

// v1ProviderUtils names the provider-utils version of the AI SDK package the
// OpenCode 1.x client routes a protocol through. System One has no v1
// counterpart and reports the chat package.
export function v1ProviderUtils(protocol: Protocol): string {
  switch (protocol) {
    case "responses":
      return V1_RESPONSES_SDK;
    case "anthropic":
      return V1_ANTHROPIC_SDK;
    default:
      return V1_CHAT_SDK;
  }
}

// v1UserAgent renders the v1 lane's model user agent.
export function v1UserAgent(providerUtils: string): string {
  return `opencode/1.19.3 ai-sdk/provider-utils/${providerUtils} runtime/bun/1.3.14`;
}

// tierBaseURL returns the base URL of a key tier.
export function tierBaseURL(
  upstream: { zen: string; go: string; anonymous: string },
  tier: Tier,
): string {
  return tier === "go" ? upstream.go : upstream.zen;
}

// upstreamURL builds the URL of an upstream endpoint.
export function upstreamURL(baseURL: string, protocol: Protocol): string {
  const trimmed = baseURL.replace(/\/+$/, "");
  if (trimmed.toLowerCase().endsWith("/inference")) {
    const family = protocol === "anthropic" ? "/anthropic" : "/openai";
    return `${trimmed}${family}${protocolPath(protocol)}`;
  }
  return trimmed + protocolPath(protocol);
}
