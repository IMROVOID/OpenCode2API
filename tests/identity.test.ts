import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalSessionID,
  ascendingID,
  asPrefix,
  claudeCodeSessionID,
  isOfficialSessionID,
  randomID,
  scopedSessionID,
} from "../src/protocol/identity.js";
import { sha256Hex } from "../src/protocol/sha256.js";
import { createHash } from "node:crypto";

describe("sha256", () => {
  it("matches the reference digest for the empty string", () => {
    // Arrange
    const input = "";
    // Act
    const digest = sha256Hex(input);
    // Assert
    assert.equal(
      digest,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the reference digest for abc", () => {
    // Arrange
    const input = "abc";
    // Act
    const digest = sha256Hex(input);
    // Assert
    assert.equal(
      digest,
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches node's digest for a long input", () => {
    // Arrange
    const input = "a".repeat(1000);
    // Act
    const digest = sha256Hex(input);
    // Assert
    assert.equal(digest, createHash("sha256").update(input).digest("hex"));
  });
});

describe("canonicalSessionID", () => {
  it("keeps an official session id verbatim", () => {
    // Arrange
    const id = "ses_770de4b91ffe604cEZgeBmNhNX";
    // Act
    const result = canonicalSessionID(id);
    // Assert
    assert.equal(result, id);
  });

  it("derives the documented id for hello-world", () => {
    // Arrange
    const signal = "hello-world";
    // Act
    const result = canonicalSessionID(signal);
    // Assert
    assert.equal(result, "ses_770de4b91ffe604cEZgeBmNhNX");
  });

  it("derives the documented id for the empty object", () => {
    // Arrange
    const signal = "{}";
    // Act
    const result = canonicalSessionID(signal);
    // Assert
    assert.equal(result, "ses_feaca0186ffe12N0aVhScuiUKY");
  });

  it("derives the documented id for global", () => {
    // Arrange
    const signal = "global";
    // Act
    const result = canonicalSessionID(signal);
    // Assert
    assert.equal(result, "ses_4c86fa44effe3A2voSQN7agsVR");
  });

  it("recognizes its own ids as official", () => {
    // Arrange
    const id = canonicalSessionID("hello-world");
    // Act
    const official = isOfficialSessionID(id);
    // Assert
    assert.equal(official, true);
  });

  it("ends the time part in ffe", () => {
    // Arrange
    const id = canonicalSessionID("some-signal");
    // Act
    const timePart = id.slice(4, 16);
    // Assert
    assert.match(timePart, /^[0-9a-f]{9}f[c-f][0-9a-f]$/);
  });
});

describe("scopedSessionID", () => {
  it("keeps an official session id regardless of the scope", () => {
    // Arrange
    const id = "ses_770de4b91ffe604cEZgeBmNhNX";
    // Act
    const result = scopedSessionID("scope", id);
    // Assert
    assert.equal(result, id);
  });

  it("scopes a non-official signal", () => {
    // Arrange
    const signal = "hello-world";
    // Act
    const scoped = scopedSessionID("scope", signal);
    // Assert
    assert.notEqual(scoped, canonicalSessionID(signal));
  });
});

describe("ascendingID", () => {
  it("emits a 31-character id with the prefix", () => {
    // Arrange
    const prefix = "msg";
    const now = 1792713600000;
    // Act
    const id = ascendingID(prefix, now);
    // Assert
    assert.match(id, /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  });

  it("emits a counter that rises within one millisecond", () => {
    // Arrange
    const now = 1792713600000;
    // Act
    const first = ascendingID("msg", now);
    const second = ascendingID("msg", now);
    // Assert
    assert.notEqual(first, second);
  });
});

describe("randomID", () => {
  it("emits the prefix and the requested byte count in hex", () => {
    // Arrange
    const prefix = "resp";
    const size = 12;
    // Act
    const id = randomID(prefix, size);
    // Assert
    assert.match(id, /^resp_[0-9a-f]{24}$/);
  });
});

describe("asPrefix", () => {
  it("keeps an id that already has the prefix", () => {
    // Arrange
    const id = "chatcmpl_abc";
    // Act
    const result = asPrefix(id, "chatcmpl");
    // Assert
    assert.equal(result, "chatcmpl_abc");
  });

  it("strips a chatcmpl prefix before adding another one", () => {
    // Arrange
    const id = "chatcmpl_abc";
    // Act
    const result = asPrefix(id, "resp");
    // Assert
    assert.equal(result, "resp_abc");
  });

  it("strips a resp prefix before adding a msg one", () => {
    // Arrange
    const id = "resp_abc";
    // Act
    const result = asPrefix(id, "msg");
    // Assert
    assert.equal(result, "msg_abc");
  });
});

describe("claudeCodeSessionID", () => {
  it("extracts the trailing uuid of a claude code user id", () => {
    // Arrange
    const userID = "user_abc_session_123e4567-e89b-12d3-a456-426614174000";
    // Act
    const result = claudeCodeSessionID(userID);
    // Assert
    assert.equal(result, "123e4567-e89b-12d3-a456-426614174000");
  });

  it("reads the session id of a json user id", () => {
    // Arrange
    const userID = JSON.stringify({ session_id: "abc123" });
    // Act
    const result = claudeCodeSessionID(userID);
    // Assert
    assert.equal(result, "abc123");
  });

  it("returns nothing for an unrelated user id", () => {
    // Arrange
    const userID = "someone";
    // Act
    const result = claudeCodeSessionID(userID);
    // Assert
    assert.equal(result, "");
  });
});
