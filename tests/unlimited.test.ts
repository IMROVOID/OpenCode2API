import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AAAA_POOL,
  buildEdgeFetchInit,
  createLaneIdentity,
  normalizePrefix64,
  resolveEdgePool,
} from "../src/unlimited/lane.js";
import {
  BLACKLIST_MAX,
  MAX_HOP_TRIES,
  UnlimitedGuard,
  isQuotaWall,
} from "../src/unlimited/guard.js";
import {
  buildDoctorReport,
  isCloudflareEgress,
  probeEgress,
} from "../src/unlimited/doctor.js";
import { forwardWithUnlimitedGuard } from "../src/worker/unlimited.js";
import worker from "../src/worker/index.js";

describe("unlimited lane (zen-lane)", () => {
  it("normalizes full and compressed IPv6 addresses to /64 prefix", () => {
    // Arrange
    const full = "2606:4700:0010:0000:ac42:ad95:0001:0002";
    const compressed = "2606:4700:10::ac42:ad95";
    const client = "2a09:bac5:1234:5678::1";

    // Act & Assert
    assert.equal(normalizePrefix64(full), "2606:4700:10:0");
    assert.equal(normalizePrefix64(compressed), "2606:4700:10:0");
    assert.equal(normalizePrefix64(client), "2a09:bac5:1234:5678");
  });

  it("resolves live AAAA pool via DoH and filters non-IPv6 records", async () => {
    // Arrange
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          Status: 0,
          Answer: [
            { type: 28, data: "2606:4700:10::ac42:ad95" },
            { type: 28, data: "not-an-ipv6-address; error: timeout" },
            { type: 28, data: "2606:4700:10::6814:2011" },
          ],
        }),
        { status: 200 },
      );

    // Act
    const pool = await resolveEdgePool(mockFetch);

    // Assert
    assert.deepEqual(pool, [
      "2606:4700:10::6814:2011",
      "2606:4700:10::ac42:ad95",
    ]);
  });

  it("falls back to DEFAULT_AAAA_POOL when DoH fails", async () => {
    // Arrange
    const failingFetch: typeof fetch = async () => {
      throw new Error("network down");
    };

    // Act
    const pool = await resolveEdgePool(failingFetch);

    // Assert
    assert.deepEqual(pool, [...DEFAULT_AAAA_POOL]);
  });

  it("creates a fresh lane identity with 32-hex machineId and 40-hex project", () => {
    // Arrange & Act
    const first = createLaneIdentity("worker");
    const second = createLaneIdentity("worker");

    // Assert
    assert.match(first.ids.session, /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    assert.match(first.ids.message, /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    assert.match(first.ids.project, /^[0-9a-f]{40}$/);
    assert.match(first.machineId, /^[0-9a-f]{32}$/);
    assert.notEqual(first.ids.session, second.ids.session);
    assert.notEqual(first.machineId, second.machineId);
  });

  it("attaches Cloudflare cf.resolveOverride to RequestInit", () => {
    // Arrange
    const base: RequestInit = { method: "POST", body: "{}" };

    // Act
    const withEdge = buildEdgeFetchInit(base, "2606:4700:10::ac42:ad95");

    // Assert
    assert.equal(withEdge.method, "POST");
    assert.deepEqual((withEdge as Record<string, unknown>)["cf"], {
      resolveOverride: "2606:4700:10::ac42:ad95",
    });
  });
});

describe("unlimited guard (zen-guard & zen-hop)", () => {
  it("detects quota walls from status and body text", () => {
    // Arrange & Act & Assert
    assert.equal(isQuotaWall(429, ""), true);
    assert.equal(isQuotaWall(403, '{"error":"FreeTierError: QuotaExceeded"}'), true);
    assert.equal(isQuotaWall(200, 'event: error\ndata: {"message":"Free usage limit reached"}\n\n'), true);
    assert.equal(isQuotaWall(200, '{"id":"chatcmpl_1","choices":[]}'), false);
    assert.equal(isQuotaWall(400, '{"error":"model is required"}'), false);
  });

  it("blacklists /64 blocks, detects burned addresses in same /64, and caps at 200", () => {
    // Arrange
    const guard = new UnlimitedGuard(["2606:4700:10::ac42:ad95", "2a09:bac5:100:200::1"]);

    // Act
    guard.blacklistAdd("2606:4700:10::ac42:ad95");

    // Assert — different interface ID in same /64 is recognized as burnt
    assert.equal(guard.isBurnt("2606:4700:10::9999:1111"), true);
    assert.equal(guard.isBurnt("2a09:bac5:100:200::2"), false);

    // Cap at BLACKLIST_MAX (200)
    for (let i = 0; i < 250; i += 1) {
      guard.blacklistAdd(`2a09:bac5:${i.toString(16)}:1::1`);
    }
    assert.equal(guard.snapshot().blacklist.length, BLACKLIST_MAX);
  });

  it("recycles oldest /64 block when every block in pool is blacklisted", () => {
    // Arrange
    const pool = [
      "2606:4700:1::1",
      "2606:4700:2::1",
    ];
    const guard = new UnlimitedGuard(pool);
    guard.blacklistAdd("2606:4700:1::1");
    guard.blacklistAdd("2606:4700:2::1");

    // Act
    const hopped = guard.hop(pool);

    // Assert
    assert.equal(hopped.edge, "2606:4700:1::1");
    assert.equal(guard.snapshot().hops, 1);
  });

  it("auto-hops on QuotaExceeded up to MAX_HOP_TRIES until a clean lane succeeds", async () => {
    // Arrange
    const pool = [
      "2606:4700:1::1",
      "2606:4700:2::1",
      "2606:4700:3::1",
    ];
    const guard = new UnlimitedGuard(pool);
    const seenSessions: string[] = [];
    let calls = 0;

    // Act
    const result = await guard.executeWithGuard(async (lane) => {
      calls += 1;
      seenSessions.push(lane.ids.session);
      if (calls < 3) {
        return {
          status: 429,
          bodyPreview: '{"error":"QuotaExceeded: Free usage limit reached"}',
          value: "walled",
        };
      }
      return {
        status: 200,
        bodyPreview: "",
        value: "ok",
      };
    });

    // Assert
    assert.equal(MAX_HOP_TRIES, 8);
    assert.equal(calls, 3);
    assert.equal(result.value, "ok");
    assert.equal(guard.snapshot().hops, 2);
    assert.equal(new Set(seenSessions).size, 3);
  });
});

describe("unlimited doctor & leak-guard", () => {
  it("recognizes Cloudflare WARP IPv6 and IPv4 ranges", () => {
    assert.equal(isCloudflareEgress("2606:4700:10::ac42:ad95"), true);
    assert.equal(isCloudflareEgress("2a09:bac5:39c8:1dc2::2ef:3b"), true);
    assert.equal(isCloudflareEgress("2001:db8:1234::1"), false);
  });

  it("builds a complete doctor health report", async () => {
    // Arrange
    const guard = new UnlimitedGuard(["2606:4700:10::ac42:ad95"]);
    const mockFetch: typeof fetch = async () =>
      new Response("2a09:bac5:1234:5678::1", { status: 200 });

    // Act
    const egress = await probeEgress(mockFetch);
    const report = await buildDoctorReport(guard, mockFetch, "cloudflare-worker");

    // Assert
    assert.equal(egress.isCloudflare, true);
    assert.equal(egress.prefix64, "2a09:bac5:1234:5678");
    assert.equal(report.status, "ok");
    assert.equal(report.runtime, "cloudflare-worker");
    assert.equal(report.egress.isCloudflare, true);
  });
});

describe("Cloudflare Worker unlimited endpoints & forwarding", () => {
  it("serves GET /v1/unlimited/doctor and POST /v1/unlimited/hop", async () => {
    // Arrange
    const env = {};

    // Act
    const hopRes = await worker.fetch(
      new Request("https://worker.example/v1/unlimited/hop", { method: "POST" }),
      env,
    );
    const hopBody = (await hopRes.json()) as Record<string, unknown>;

    const docRes = await worker.fetch(
      new Request("https://worker.example/v1/unlimited/doctor", { method: "GET" }),
      env,
    );
    const docBody = (await docRes.json()) as Record<string, unknown>;

    // Assert
    assert.equal(hopRes.status, 200);
    assert.equal(typeof hopBody["new_edge"], "string");
    assert.equal(typeof hopBody["hops"], "number");
    assert.equal(docRes.status, 200);
    assert.equal(docBody["runtime"], "cloudflare-worker");
  });

  it("auto-rotates edge and identity when Worker forward hits a 429 quota wall", async () => {
    // Arrange
    let attempts = 0;
    const seenAuth: string[] = [];
    const mockFetch: typeof fetch = async (_input, init) => {
      attempts += 1;
      const headers = new Headers(init?.headers);
      seenAuth.push(headers.get("authorization") ?? "");
      if (attempts === 1) {
        return new Response('{"error":"QuotaExceeded: Free usage limit reached"}', {
          status: 429,
        });
      }
      return new Response('{"id":"chatcmpl_ok","choices":[]}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const initial = createLaneIdentity("worker").ids;

    // Act
    const response = await forwardWithUnlimitedGuard(
      {},
      "chat",
      { model: "glm-5.3", messages: [{ role: "user", content: "hi" }] },
      initial,
      { "Access-Control-Allow-Origin": "*" },
      mockFetch,
    );
    const body = (await response.json()) as Record<string, unknown>;

    // Assert
    assert.equal(response.status, 200);
    assert.equal(attempts, 2);
    assert.equal(seenAuth[0], "Bearer public");
    assert.equal(body["id"], "chatcmpl_ok");
    assert.equal(typeof response.headers.get("x-opencode-edge"), "string");
  });
});
