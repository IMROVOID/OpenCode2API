import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

interface WorkerBundleModule {
  default?: {
    fetch?: (request: Request, env: Record<string, string | undefined>) => Promise<Response>;
  };
}

async function verifyWorkerBundle(): Promise<void> {
  const workerPath = path.resolve("worker/worker.js");
  const source = await fs.readFile(workerPath, "utf8");

  // 1. Ensure no Node.js built-ins leaked into the neutral Worker bundle.
  if (source.includes("node:")) {
    throw new Error("worker/worker.js references a forbidden 'node:' built-in module.");
  }
  console.log("✓ worker/worker.js contains no Node built-ins");

  // 2. Simulate Cloudflare Workers (workerd) global-scope restrictions during module evaluation.
  const origGetRandomValues = crypto.getRandomValues.bind(crypto);
  const origFetch = globalThis.fetch;
  const origSetTimeout = globalThis.setTimeout;
  const origSetInterval = globalThis.setInterval;

  const disallowGlobalScope = (op: string): never => {
    throw new Error(
      `Disallowed operation called within global scope (${op}). Perform this operation within a handler.`,
    );
  };

  crypto.getRandomValues = (() => disallowGlobalScope("crypto.getRandomValues")) as typeof crypto.getRandomValues;
  globalThis.fetch = (() => disallowGlobalScope("fetch")) as typeof fetch;
  globalThis.setTimeout = (() => disallowGlobalScope("setTimeout")) as unknown as typeof setTimeout;
  globalThis.setInterval = (() => disallowGlobalScope("setInterval")) as unknown as typeof setInterval;

  let mod: WorkerBundleModule;
  try {
    const fileUrl = `${pathToFileURL(workerPath).href}?t=${Date.now()}`;
    mod = (await import(fileUrl)) as WorkerBundleModule;
  } finally {
    crypto.getRandomValues = origGetRandomValues;
    globalThis.fetch = origFetch;
    globalThis.setTimeout = origSetTimeout;
    globalThis.setInterval = origSetInterval;
  }

  const workerFetch = mod.default?.fetch;
  if (typeof workerFetch !== "function") {
    throw new Error("worker/worker.js must export default.fetch");
  }
  console.log("✓ worker/worker.js passed Cloudflare Workers global-scope evaluation check");

  // 3. Smoke-test the bundled Worker handlers with mocked upstream fetch.
  let upstreamAttempts = 0;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("1.1.1.1/dns-query")) {
      return new Response(
        JSON.stringify({
          Status: 0,
          Answer: [
            { type: 28, data: "2606:4700:10::ac42:ad95" },
            { type: 28, data: "2606:4700:10::6814:2011" },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("api64.ipify.org")) {
      return new Response("2606:4700:10::ac42:ad95", { status: 200 });
    }
    upstreamAttempts += 1;
    if (upstreamAttempts === 1) {
      return new Response('{"error":"QuotaExceeded: Free usage limit reached"}', {
        status: 429,
      });
    }
    return new Response(
      JSON.stringify({
        id: "chatcmpl_verified",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    // Health endpoint
    const healthRes = await workerFetch(new Request("https://worker.test/healthz"), {});
    assert.equal(healthRes.status, 200);

    // WebUI endpoint
    const uiRes = await workerFetch(new Request("https://worker.test/"), {});
    assert.equal(uiRes.status, 200);
    assert.match(uiRes.headers.get("content-type") ?? "", /text\/html/);

    // Doctor endpoint
    const docRes = await workerFetch(new Request("https://worker.test/v1/unlimited/doctor"), {});
    assert.equal(docRes.status, 200);
    const docJson = (await docRes.json()) as Record<string, unknown>;
    assert.equal(docJson["status"], "ok");
    assert.equal(docJson["runtime"], "cloudflare-worker");

    // Hop endpoint
    const hopRes = await workerFetch(
      new Request("https://worker.test/v1/unlimited/hop", { method: "POST" }),
      {},
    );
    assert.equal(hopRes.status, 200);
    const hopJson = (await hopRes.json()) as Record<string, unknown>;
    assert.equal(hopJson["status"], "rotated");

    // Self-healing completion forwarding on 429 QuotaExceeded
    const chatRes = await workerFetch(
      new Request("https://worker.test/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "glm-5.3",
          messages: [{ role: "user", content: "ping" }],
        }),
      }),
      {},
    );
    assert.equal(chatRes.status, 200);
    assert.equal(upstreamAttempts, 2);
    console.log("✓ worker/worker.js passed all runtime handler & self-healing smoke tests");
  } finally {
    globalThis.fetch = origFetch;
  }
}

verifyWorkerBundle().catch((error) => {
  console.error("✗ Worker bundle verification failed:", error);
  process.exit(1);
});
