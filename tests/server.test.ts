import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type IncomingMessage, type ServerResponse } from "node:http";
import {
  clientKey,
  constantTimeEquals,
  parseListen,
  RequestDispatcher,
  startServer,
} from "../src/server/dispatcher.js";
import { LogBroker } from "../src/telemetry/log-broker.js";
import { Logger } from "../src/telemetry/logger.js";
import { Metrics } from "../src/telemetry/metrics.js";
import { hashPassword, verifyPassword } from "../src/server/admin/server.js";
import { SessionStore, authVersionOf } from "../src/server/admin/session.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { fingerprintSecret } from "../src/config/secrets.js";

// A request the dispatcher can serve.
function mockRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  return {
    method,
    url,
    headers: { host: "localhost", ...headers },
    socket: { remoteAddress: "127.0.0.1" },
    on: () => undefined,
    async *[Symbol.asyncIterator](): AsyncIterator<Buffer> {
      return undefined;
    },
  } as unknown as IncomingMessage;
}

// A response the dispatcher can write to.
class MockResponse {
  status = 0;
  body = "";
  readonly headers: Record<string, string | string[]> = {};

  writeHead(status: number, headers?: Record<string, string | string[]>): this {
    this.status = status;
    for (const [name, value] of Object.entries(headers ?? {})) {
      this.headers[name.toLowerCase()] = value;
    }
    return this;
  }

  setHeader(name: string, value: string | string[]): void {
    this.headers[name.toLowerCase()] = value;
  }

  end(chunk?: string | Buffer): void {
    if (chunk !== undefined) {
      this.body = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    }
  }
}

describe("parseListen", () => {
  it("splits a host and a port", () => {
    // Arrange
    const listen = "127.0.0.1:8080";
    // Act
    const result = parseListen(listen);
    // Assert
    assert.deepEqual(result, { host: "127.0.0.1", port: 8080 });
  });

  it("keeps a wildcard host", () => {
    // Arrange
    const listen = "0.0.0.0:8081";
    // Act
    const result = parseListen(listen);
    // Assert
    assert.deepEqual(result, { host: "0.0.0.0", port: 8081 });
  });

  it("falls back to the defaults for a value without a port", () => {
    // Arrange
    const listen = "localhost";
    // Act
    const result = parseListen(listen);
    // Assert
    assert.deepEqual(result, { host: "127.0.0.1", port: 8080 });
  });
});

describe("clientKey", () => {
  it("reads the x-api-key header", () => {
    // Arrange
    const request = mockRequest("GET", "/", { "x-api-key": "k" });
    // Act and assert
    assert.equal(clientKey(request), "k");
  });

  it("reads a bearer authorization header", () => {
    // Arrange
    const request = mockRequest("GET", "/", { authorization: "Bearer abc" });
    // Act and assert
    assert.equal(clientKey(request), "abc");
  });

  it("ignores a non-bearer authorization header", () => {
    // Arrange
    const request = mockRequest("GET", "/", { authorization: "Basic abc" });
    // Act and assert
    assert.equal(clientKey(request), "");
  });
});

describe("constantTimeEquals", () => {
  it("accepts two equal secrets", () => {
    // Arrange
    const left = "secret";
    // Act and assert
    assert.equal(constantTimeEquals(left, "secret"), true);
  });

  it("rejects two different secrets", () => {
    // Arrange
    const left = "secret";
    // Act and assert
    assert.equal(constantTimeEquals(left, "other"), false);
  });

  it("rejects secrets of different lengths", () => {
    // Arrange
    const left = "secret";
    // Act and assert
    assert.equal(constantTimeEquals(left, "secre"), false);
  });
});

describe("RequestDispatcher", () => {
  it("serves a route without a key when no key is configured", async () => {
    // Arrange
    const dispatcher = new RequestDispatcher(() => []);
    dispatcher.register({
      method: "GET",
      path: "/ping",
      protocol: "chat",
      handler: (context) => {
        context.response.writeHead(200, { "Content-Type": "application/json" });
        context.response.end('{"ok":true}');
      },
    });
    const response = new MockResponse();
    // Act
    await dispatcher.dispatch(mockRequest("GET", "/ping"), response as unknown as ServerResponse);
    // Assert
    assert.equal(response.status, 200);
    assert.equal(response.body, '{"ok":true}');
  });

  it("rejects a request without a valid key", async () => {
    // Arrange
    const dispatcher = new RequestDispatcher(() => ["secret"]);
    dispatcher.register({
      method: "GET",
      path: "/ping",
      protocol: "chat",
      handler: () => undefined,
    });
    const response = new MockResponse();
    // Act
    await dispatcher.dispatch(mockRequest("GET", "/ping"), response as unknown as ServerResponse);
    // Assert
    assert.equal(response.status, 401);
  });

  it("accepts a request with a valid key", async () => {
    // Arrange
    const dispatcher = new RequestDispatcher(() => ["secret"]);
    dispatcher.register({
      method: "GET",
      path: "/ping",
      protocol: "chat",
      handler: (context) => {
        context.response.writeHead(200);
        context.response.end("ok");
      },
    });
    const response = new MockResponse();
    // Act
    await dispatcher.dispatch(
      mockRequest("GET", "/ping", { authorization: "Bearer secret" }),
      response as unknown as ServerResponse,
    );
    // Assert
    assert.equal(response.status, 200);
  });

  it("serves a public route without a key", async () => {
    // Arrange
    const dispatcher = new RequestDispatcher(() => ["secret"]);
    dispatcher.register({
      method: "GET",
      path: "/healthz",
      protocol: "chat",
      public: true,
      handler: (context) => {
        context.response.writeHead(200);
        context.response.end("ok");
      },
    });
    const response = new MockResponse();
    // Act
    await dispatcher.dispatch(mockRequest("GET", "/healthz"), response as unknown as ServerResponse);
    // Assert
    assert.equal(response.status, 200);
  });

  it("answers a preflight with 204", async () => {
    // Arrange
    const dispatcher = new RequestDispatcher(() => []);
    const response = new MockResponse();
    // Act
    await dispatcher.dispatch(mockRequest("OPTIONS", "/ping"), response as unknown as ServerResponse);
    // Assert
    assert.equal(response.status, 204);
  });

  it("answers an unknown route with 404", async () => {
    // Arrange
    const dispatcher = new RequestDispatcher(() => []);
    const response = new MockResponse();
    // Act
    await dispatcher.dispatch(mockRequest("GET", "/nope"), response as unknown as ServerResponse);
    // Assert
    assert.equal(response.status, 404);
  });
});

describe("startServer", () => {
  it("binds a port and serves a request", async () => {
    // Arrange
    const dispatcher = new RequestDispatcher(() => []);
    dispatcher.register({
      method: "GET",
      path: "/ping",
      protocol: "chat",
      handler: (context) => {
        context.response.writeHead(200, { "Content-Type": "text/plain" });
        context.response.end("pong");
      },
    });
    const server = await startServer(dispatcher, "127.0.0.1:0");
    // Act
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/ping`);
    const text = await response.text();
    // Assert
    assert.equal(text, "pong");
    server.close();
  });
});

describe("LogBroker", () => {
  it("publishes an event with a rising sequence", () => {
    // Arrange
    const broker = new LogBroker(100);
    // Act
    broker.publish({
      sequence: 0,
      time: "2026-01-01T00:00:00.000Z",
      level: "info",
      message: "first",
      component: "test",
      fields: {},
    });
    const recent = broker.recent(0, 10);
    // Assert
    assert.equal(recent.events[0]?.sequence, 1);
  });

  it("returns only the events after a cursor", () => {
    // Arrange
    const broker = new LogBroker(100);
    for (let i = 0; i < 3; i += 1) {
      broker.publish({
        sequence: 0,
        time: "2026-01-01T00:00:00.000Z",
        level: "info",
        message: `event ${i}`,
        component: "test",
        fields: {},
      });
    }
    // Act
    const recent = broker.recent(2, 10);
    // Assert
    assert.equal(recent.events.length, 1);
    assert.equal(recent.events[0]?.message, "event 2");
  });

  it("reports a gap when the cursor expired", () => {
    // Arrange
    const broker = new LogBroker(100);
    broker.publish({
      sequence: 0,
      time: "2026-01-01T00:00:00.000Z",
      level: "info",
      message: "old",
      component: "test",
      fields: {},
    });
    // Act
    const recent = broker.recent(0, 10);
    // Assert
    assert.equal(recent.gap, false);
  });

  it("delivers a published event to a subscriber", () => {
    // Arrange
    const broker = new LogBroker(100);
    const seen: number[] = [];
    broker.subscribe((event) => seen.push(event.sequence));
    // Act
    broker.publish({
      sequence: 0,
      time: "2026-01-01T00:00:00.000Z",
      level: "info",
      message: "live",
      component: "test",
      fields: {},
    });
    // Assert
    assert.deepEqual(seen, [1]);
  });
});

describe("Logger", () => {
  it("masks a secret out of a field", () => {
    // Arrange
    const broker = new LogBroker(100);
    const logger = new Logger(broker);
    logger.replaceSecrets(["supersecret"]);
    // Act
    logger.info("hello", "test", { password: "supersecret" });
    // Assert
    const recent = broker.recent(0, 10);
    assert.equal(recent.events[0]?.fields["password"], "***");
  });

  it("redacts a secret out of the message", () => {
    // Arrange
    const broker = new LogBroker(100);
    const logger = new Logger(broker);
    logger.replaceSecrets(["supersecret"]);
    // Act
    logger.info("the key is supersecret", "test");
    // Assert
    const recent = broker.recent(0, 10);
    assert.equal(recent.events[0]?.message, "the key is ***");
  });

  it("drops the events below the level", () => {
    // Arrange
    const broker = new LogBroker(100);
    const logger = new Logger(broker);
    logger.setLevel("warn");
    // Act
    logger.debug("noise", "test");
    logger.warn("signal", "test");
    // Assert
    const recent = broker.recent(0, 10);
    assert.equal(recent.events.length, 1);
    assert.equal(recent.events[0]?.message, "signal");
  });
});

describe("Metrics", () => {
  it("counts a successful request", () => {
    // Arrange
    const metrics = new Metrics();
    // Act
    metrics.record(
      "/v1/chat/completions",
      200,
      120,
      undefined,
    );
    // Assert
    const snapshot = metrics.snapshot();
    assert.equal(snapshot.lifetime.total, 1);
    assert.equal(snapshot.lifetime.errors, 1);
  });

  it("counts a request with an empty outcome as a success", () => {
    // Arrange
    const metrics = new Metrics();
    // Act
    metrics.record("/v1/chat/completions", 200, 120, {
      modelAlias: "m",
      model: "m",
      tier: "go",
      protocol: "chat",
      request: "req_1",
      session: "ses_1",
      keyId: "abcde",
      channel: "key",
      anonymous: false,
      proxy: "",
      attempts: 1,
      legs: [],
      stop: "",
      tail: "",
      stream: false,
      serverKeyId: "sk",
      shaped: false,
      toolAlias: "",
      usage: undefined,
      usageReported: false,
      attemptOutcome: "",
      outcome: "",
    });
    // Assert
    const snapshot = metrics.snapshot();
    assert.equal(snapshot.lifetime.success, 1);
  });

  it("records an upstream attempt", () => {
    // Arrange
    const metrics = new Metrics();
    // Act
    metrics.recordAttempt({
      time: new Date().toISOString(),
      request_id: "req_1",
      model: "m",
      tier: "go",
      attempt: 1,
      key_id: "abcde",
      channel: "key",
      anonymous: false,
      proxy_node: "",
      status: 200,
      duration_ms: 10,
      success: true,
      outcome: "success",
    });
    // Assert
    const snapshot = metrics.snapshot();
    assert.equal(snapshot.upstream.lifetime.total, 1);
    assert.equal(snapshot.upstream.lifetime.success, 1);
  });
});

describe("password hashing", () => {
  it("verifies a password against its hash", () => {
    // Arrange
    const password = "a-long-admin-password";
    const hash = hashPassword(password);
    // Act and assert
    assert.equal(verifyPassword(hash, password), true);
  });

  it("rejects the wrong password", () => {
    // Arrange
    const hash = hashPassword("a-long-admin-password");
    // Act and assert
    assert.equal(verifyPassword(hash, "another-password"), false);
  });

  it("rejects a malformed hash", () => {
    // Arrange
    const hash = "not-a-hash";
    // Act and assert
    assert.equal(verifyPassword(hash, "a-long-admin-password"), false);
  });
});

describe("SessionStore", () => {
  it("issues a session and returns it for its token", () => {
    // Arrange
    const store = new SessionStore();
    // Act
    const { token } = store.create("admin", "v1", 60);
    const session = store.get(token);
    // Assert
    assert.equal(session?.username, "admin");
    assert.equal(session?.authVersion, "v1");
  });

  it("does not store the raw token", () => {
    // Arrange
    const store = new SessionStore();
    // Act
    const { token } = store.create("admin", "v1", 60);
    // Assert
    assert.equal(store.get("wrong-token"), undefined);
    assert.equal(store.get(token)?.username, "admin");
  });

  it("drops every session", () => {
    // Arrange
    const store = new SessionStore();
    const { token } = store.create("admin", "v1", 60);
    // Act
    store.dropAll();
    // Assert
    assert.equal(store.get(token), undefined);
  });

  it("derives the auth version from the password hash", () => {
    // Arrange
    const config = { ...DEFAULT_CONFIG, webui: { ...DEFAULT_CONFIG.webui, password_hash: "hash-value" } };
    // Act
    const version = authVersionOf(config);
    // Assert
    assert.equal(version, fingerprintSecret("hash-value"));
  });
});
