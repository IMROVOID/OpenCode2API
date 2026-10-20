import type { Tier } from "../types/config.js";
import type { Route } from "../types/inference.js";
import { isPlainObject, mapAt, stringAt } from "../protocol/json-util.js";
import { prepareAnonymousBody } from "../protocol/tools.js";

// RouteBodies is the request body of each tier the route can fall back to.
export interface RouteBodies {
  zen: string;
  go: string;
}

// The request shaping the upstream lanes need. A shaped request is force
// streamed upstream and collapsed back for the client that asked for a plain
// reply.
export interface RequestShape {
  shaped: boolean;
  toolAlias: string;
}

// prepareRouteBodies renders the request body for every tier the route can
// fall back to. The v1 lane needs a read tool and the v2 lane the core
// tools, so the body is shaped per tier.
export function prepareRouteBodies(
  route: Route,
  payload: Record<string, unknown>,
  isV1: (tier: Tier) => boolean,
): { bodies: RouteBodies; shape: RequestShape } {
  const raw = JSON.stringify(payload);
  const bodies: RouteBodies = { zen: raw, go: raw };
  const shape: RequestShape = { shaped: false, toolAlias: "" };

  const tiers: Tier[] = route.anonymous
    ? ["zen"]
    : route.keyTiers.length > 0
      ? route.keyTiers
      : [route.tier];
  for (const tier of tiers) {
    if (!isV1(tier)) {
      continue;
    }
    const prepared = prepareAnonymousBody(raw, route.protocol, true);
    if (tier === "go") {
      bodies.go = prepared.body;
    } else {
      bodies.zen = prepared.body;
    }
    if (prepared.alias !== "") {
      shape.toolAlias = prepared.alias;
    }
    if (prepared.shaped) {
      shape.shaped = true;
    }
  }
  if (route.anonymous) {
    // The anonymous lane shapes its own body per upstream gate, so the raw
    // body is handed on unchanged.
    bodies.zen = raw;
  }
  return { bodies, shape };
}

// isSystemOnePayload reports whether a payload carries the System One
// decision shape.
export function isSystemOnePayload(payload: Record<string, unknown>): boolean {
  return (
    Object.keys(mapAt(payload, "questions")).length > 0 &&
    payload["state"] !== undefined &&
    payload["state"] !== null
  );
}

// requestModel reads the model a request asks for.
export function requestModel(payload: Record<string, unknown>): string {
  return stringAt(payload, "model");
}

// isValidRequestPayload reports whether a decoded body is a JSON object.
export function isValidRequestPayload(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}
