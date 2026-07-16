import assert from "node:assert/strict";
import test from "node:test";

import { slugify } from "../src/slugify.js";

test("normalizes ordinary words", () => {
  assert.equal(slugify("  Context Bundle  "), "context-bundle");
});

test("normalizes punctuation and repeated separators", () => {
  assert.equal(slugify("API / Session -- Resume"), "api-session-resume");
});

test("does not leave separators at either edge", () => {
  assert.equal(slugify("---Review Ready---"), "review-ready");
});
