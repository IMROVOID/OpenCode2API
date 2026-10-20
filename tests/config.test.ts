import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../src/config/loader.js";
import { normalizeConfig } from "../src/config/normalize.js";
import { ConfigError } from "../src/config/strict-json.js";
import { cloneConfig, DEFAULT_CONFIG } from "../src/config/defaults.js";
import {
  fingerprintSecret,
  keyDisplayId,
  maskSecret,
  redactUrl,
  SecretRedactor,
} from "../src/config/secrets.js";
import { ModelCatalog } from "../src/proxy/model-catalog.js";
import { parseCapabilities, parseModels } from "../src/proxy/model-discovery.js";
import { isV1Upstream } from "../src/protocol/lanes.js";
import { protocolPath } from "../src/protocol/paths.js";

describe("config parsing", () => {
  it("reads a full config", () => {
    // Arrange
    const text = JSON.stringify({
      listen: "0.0.0.0:9000",
      zen_keys: ["sk-a"],
      prefer: "zen",
    });
    // Act
    const config = parseConfig(text, "test");
    // Assert
    assert.equal(config.listen, "0.0.0.0:9000");
    assert.deepEqual(config.zen_keys, ["sk-a"]);
    assert.equal(config.prefer, "zen");
  });

  it("keeps the defaults for the fields the file omits", () => {
    // Arrange
    const text = JSON.stringify({ listen: "0.0.0.0:9000" });
    // Act
    const config = parseConfig(text, "test");
    // Assert
    assert.equal(config.retry.max_attempts, DEFAULT_CONFIG.retry.max_attempts);
    assert.equal(config.webui.enabled, true);
  });

  it("rejects an unknown field", () => {
    // Arrange
    const text = JSON.stringify({ not_a_field: 1 });
    // Act and assert
    assert.throws(() => parseConfig(text, "test"), ConfigError);
  });

  it("rejects a body that is not an object", () => {
    // Arrange
    const text = "[]";
    // Act and assert
    assert.throws(() => parseConfig(text, "test"), ConfigError);
  });

  it("strips whole-line comments", () => {
    // Arrange
    const text = '// a comment\n{"listen": "127.0.0.1:8080"}';
    // Act
    const config = parseConfig(text, "test");
    // Assert
    assert.equal(config.listen, "127.0.0.1:8080");
  });
});

describe("config normalization", () => {
  it("rejects a rotation alias that is not a valid name", () => {
    // Arrange
    const config = cloneConfig(DEFAULT_CONFIG);
    config.rotation.sota.alias = "not valid!";
    // Act and assert
    assert.throws(() => normalizeConfig(config, "test"), ConfigError);
  });

  it("rejects the two rotation groups sharing an alias", () => {
    // Arrange
    const config = cloneConfig(DEFAULT_CONFIG);
    config.rotation.sweet.alias = config.rotation.sota.alias;
    // Act and assert
    assert.throws(() => normalizeConfig(config, "test"), ConfigError);
  });

  it("rejects a first-output timeout outside its range", () => {
    // Arrange
    const config = cloneConfig(DEFAULT_CONFIG);
    config.rotation.first_output_seconds = 0;
    // Act and assert
    assert.throws(() => normalizeConfig(config, "test"), ConfigError);
  });

  it("fills the rotation defaults", () => {
    // Arrange
    const config = cloneConfig(DEFAULT_CONFIG);
    config.server_keys = ["sk-local"];
    config.zen_keys = ["sk-upstream"];
    config.webui.password = "a-long-admin-password";
    config.rotation.sota.alias = "";
    config.rotation.sweet.alias = "";
    config.rotation.sota.order = [];
    // Act
    const normalized = normalizeConfig(config, "test");
    // Assert
    assert.equal(normalized.rotation.sota.alias, "sota");
    assert.equal(normalized.rotation.sota.order.length, 5);
  });
});

describe("secrets", () => {
  it("masks a secret with its last five characters", () => {
    // Arrange
    const value = "sk-abcdefghij";
    // Act
    const masked = maskSecret(value);
    // Assert
    assert.equal(masked, "••••fghij");
  });

  it("masks a short secret entirely", () => {
    // Arrange
    const value = "abc";
    // Act
    const masked = maskSecret(value);
    // Assert
    assert.equal(masked, "••••");
  });

  it("fingerprints a secret to sixteen hex characters", () => {
    // Arrange
    const value = "sk-abcdefghij";
    // Act
    const fingerprint = fingerprintSecret(value);
    // Assert
    assert.match(fingerprint, /^[0-9a-f]{16}$/);
  });

  it("gives the same fingerprint for the same secret", () => {
    // Arrange
    const value = "sk-abcdefghij";
    // Act and assert
    assert.equal(fingerprintSecret(value), fingerprintSecret(value));
  });

  it("shows the last five characters of a key", () => {
    // Arrange
    const value = "sk-abcdefghij";
    // Act
    const display = keyDisplayId(value);
    // Assert
    assert.equal(display, "fghij");
  });

  it("redacts the userinfo of a url", () => {
    // Arrange
    const url = "http://user:pass@proxy.example:8080";
    // Act
    const redacted = redactUrl(url);
    // Assert
    assert.equal(redacted.includes("pass"), false);
  });

  it("replaces every configured secret in a text", () => {
    // Arrange
    const redactor = new SecretRedactor();
    redactor.replace(["secret-value", "xyz"]);
    // Act
    const result = redactor.redact("a secret-value and another");
    // Assert
    assert.equal(result, "a *** and another");
  });

  it("keeps a secret shorter than four characters", () => {
    // Arrange
    const redactor = new SecretRedactor();
    redactor.replace(["ab"]);
    // Act
    const result = redactor.redact("ab cd");
    // Assert
    assert.equal(result, "ab cd");
  });
});

describe("lanes", () => {
  it("recognizes the v1 lane", () => {
    // Arrange
    const base = "https://opencode.ai/zen";
    // Act and assert
    assert.equal(isV1Upstream(base), true);
  });

  it("recognizes a v1 lane with a trailing slash", () => {
    // Arrange
    const base = "https://opencode.ai/zen/";
    // Act and assert
    assert.equal(isV1Upstream(base), true);
  });

  it("does not recognize the go lane as v1", () => {
    // Arrange
    const base = "https://opencode.ai/zen/go";
    // Act and assert
    assert.equal(isV1Upstream(base), false);
  });

  it("does not recognize the inference lane as v1", () => {
    // Arrange
    const base = "https://opencode.ai/inference";
    // Act and assert
    assert.equal(isV1Upstream(base), false);
  });

  it("maps the protocols onto their paths", () => {
    // Arrange and assert
    assert.equal(protocolPath("chat"), "/v1/chat/completions");
    assert.equal(protocolPath("responses"), "/v1/responses");
    assert.equal(protocolPath("anthropic"), "/v1/messages");
    assert.equal(protocolPath("systemone"), "/v1/systemone");
  });
});

describe("model discovery", () => {
  it("reads the model ids of a listing", () => {
    // Arrange
    const body = JSON.stringify({ data: [{ id: "a" }, { id: "b" }, { id: "" }] });
    // Act
    const models = parseModels(body);
    // Assert
    assert.deepEqual(models, ["a", "b"]);
  });

  it("rejects an empty listing", () => {
    // Arrange
    const body = JSON.stringify({ data: [] });
    // Act and assert
    assert.throws(() => parseModels(body), /empty list/);
  });

  it("reads the tier of a provider from its api url", () => {
    // Arrange
    const body = JSON.stringify({
      "opencode-go": {
        id: "opencode-go",
        api: "https://opencode.ai/zen/go",
        npm: "@ai-sdk/openai",
        models: { "model-a": { id: "model-a" } },
      },
      "opencode": {
        id: "opencode",
        api: "https://opencode.ai/zen",
        npm: "@ai-sdk/anthropic",
        models: { "model-b": { id: "model-b" } },
      },
    });
    // Act
    const capabilities = parseCapabilities(body);
    // Assert
    assert.equal(capabilities.protocols.go["model-a"], "responses");
    assert.equal(capabilities.protocols.zen["model-b"], "anthropic");
  });
});

describe("ModelCatalog", () => {
  it("lists the models both tiers advertise", () => {
    // Arrange
    const catalog = new ModelCatalog({ prefer: "go", protocols: {}, freeOnly: false });
    catalog.applyTier("zen", ["b", "a"]);
    catalog.applyTier("go", ["c"]);
    // Act
    const models = catalog.modelIDs();
    // Assert
    assert.deepEqual(models, ["a", "b", "c"]);
  });

  it("routes a model onto the anonymous lane when it is free", () => {
    // Arrange
    const catalog = new ModelCatalog({ prefer: "go", protocols: {}, freeOnly: false });
    catalog.applyTier("zen", ["model-free"]);
    // Act
    const route = catalog.route("model-free", false, false, true);
    // Assert
    assert.equal(route.anonymous, true);
    assert.equal(route.tier, "zen");
  });

  it("refuses a model that is not free when free_only is on", () => {
    // Arrange
    const catalog = new ModelCatalog({ prefer: "go", protocols: {}, freeOnly: true });
    catalog.applyTier("zen", ["model-paid"]);
    // Act and assert
    assert.throws(() => catalog.route("model-paid", true, false, false), /not free/);
  });

  it("routes onto the go tier when it is preferred and has a key", () => {
    // Arrange
    const catalog = new ModelCatalog({ prefer: "go", protocols: {}, freeOnly: false });
    catalog.applyTier("zen", ["model-a"]);
    catalog.applyTier("go", ["model-a"]);
    catalog.applyCapabilities({
      protocols: { zen: { "model-a": "chat" }, go: { "model-a": "chat" } },
      unsupported: { zen: {}, go: {} },
      metadata: { zen: {}, go: {} },
    });
    // Act
    const route = catalog.route("model-a", true, true, false);
    // Assert
    assert.equal(route.tier, "go");
    assert.deepEqual(route.keyTiers, ["go", "zen"]);
  });

  it("routes onto the zen tier when only it has a key", () => {
    // Arrange
    const catalog = new ModelCatalog({ prefer: "go", protocols: {}, freeOnly: false });
    catalog.applyTier("zen", ["model-a"]);
    catalog.applyTier("go", ["model-a"]);
    catalog.applyCapabilities({
      protocols: { zen: { "model-a": "chat" }, go: { "model-a": "chat" } },
      unsupported: { zen: {}, go: {} },
      metadata: { zen: {}, go: {} },
    });
    // Act
    const route = catalog.route("model-a", true, false, false);
    // Assert
    assert.equal(route.tier, "zen");
  });

  it("fails when no lane can serve a model", () => {
    // Arrange
    const catalog = new ModelCatalog({ prefer: "go", protocols: {}, freeOnly: false });
    catalog.applyTier("zen", ["model-a"]);
    // Act and assert
    assert.throws(
      () => catalog.route("model-a", false, false, false),
      /not available/,
    );
  });

  it("supports every model while the catalog is pending", () => {
    // Arrange
    const catalog = new ModelCatalog({ prefer: "go", protocols: {}, freeOnly: false });
    // Act and assert
    assert.equal(catalog.supported("anything"), true);
  });
});
