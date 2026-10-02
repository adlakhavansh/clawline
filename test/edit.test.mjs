import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdit, parseEdits, parseValue, hasEditFlags, describeOptions } from "../src/edit.mjs";
import { defaults } from "../src/config.mjs";

const config = () => ({ ...defaults(), rows: [["model"], ["context"]], segments: { ...defaults().segments } });

test("parseValue coerces the obvious types", () => {
  assert.equal(parseValue("true"), true);
  assert.equal(parseValue("false"), false);
  assert.equal(parseValue("null"), null);
  assert.equal(parseValue("16"), 16);
  assert.equal(parseValue("blocks"), "blocks");
});

test("toggle turns a segment on at its default row, then off", () => {
  const c = config();
  assert.match(applyEdit(c, { kind: "toggle", id: "git" }), /git on \(row 1\)/);
  assert.ok(c.rows[0].includes("git"));
  assert.match(applyEdit(c, { kind: "toggle", id: "git" }), /git off/);
  assert.equal(c.rows.flat().includes("git"), false);
});

test("segments with no default row go to the last row", () => {
  const c = config();
  applyEdit(c, { kind: "on", id: "burn" });
  assert.ok(c.rows[1].includes("burn"));
});

test("on and off are idempotent and say so", () => {
  const c = config();
  assert.match(applyEdit(c, { kind: "on", id: "model" }), /already on/);
  assert.match(applyEdit(c, { kind: "off", id: "pr" }), /already off/);
});

test("row moves a segment and creates the row if needed", () => {
  const c = config();
  assert.match(applyEdit(c, { kind: "row", id: "model", row: "3" }), /row 3/);
  assert.equal(c.rows.length, 3);
  assert.deepEqual(c.rows[0], []);
  assert.ok(c.rows[2].includes("model"));
  assert.throws(() => applyEdit(c, { kind: "row", id: "model", row: "9" }), /row must be 1 to 4/);
});

test("set writes a known option and refuses an unknown one", () => {
  const c = config();
  assert.match(applyEdit(c, { kind: "set", id: "context", option: "width", value: 16 }), /context\.width = 16/);
  assert.equal(c.segments.context.width, 16);
  assert.throws(
    () => applyEdit(c, { kind: "set", id: "context", option: "colour", value: "red" }),
    /no option "colour"/,
  );
});

test("unknown segments and themes are rejected with a usable message", () => {
  const c = config();
  assert.throws(() => applyEdit(c, { kind: "toggle", id: "nope" }), /unknown segment "nope"/);
  assert.throws(() => applyEdit(c, { kind: "theme", theme: "vaporwave" }), /unknown theme/);
  assert.match(applyEdit(c, { kind: "theme", theme: "nord" }), /theme nord/);
  assert.equal(c.theme, "nord");
});

test("parseEdits reads a whole argv in order", () => {
  const edits = parseEdits([
    "--toggle", "git",
    "--row", "tips", "1",
    "--theme", "mono",
    "--set", "context.glyphs=ascii",
    "--off", "cost",
  ]);
  assert.deepEqual(edits, [
    { kind: "toggle", id: "git" },
    { kind: "row", id: "tips", row: "1" },
    { kind: "theme", theme: "mono" },
    { kind: "set", id: "context", option: "glyphs", value: "ascii" },
    { kind: "off", id: "cost" },
  ]);
});

test("malformed edit flags explain themselves", () => {
  assert.throws(() => parseEdits(["--toggle"]), /needs a segment id/);
  assert.throws(() => parseEdits(["--toggle", "--theme"]), /needs a segment id/);
  assert.throws(() => parseEdits(["--set", "context-width-16"]), /segment\.option=value/);
  assert.throws(() => parseEdits(["--row", "tips"]), /row number/);
});

test("hasEditFlags only fires on edit flags", () => {
  assert.equal(hasEditFlags(["--render"]), false);
  assert.equal(hasEditFlags(["--doctor"]), false);
  assert.equal(hasEditFlags(["--set", "context.width=12"]), true);
  assert.equal(hasEditFlags(["--theme", "nord"]), true);
});

test("describeOptions lists a segment's knobs", () => {
  assert.match(describeOptions("context"), /width=10/);
  assert.match(describeOptions("cost"), /no options/);
  assert.equal(describeOptions("nope"), "");
});
