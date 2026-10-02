import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every test points CLAUDE_CONFIG_DIR at a throwaway directory, so nothing here touches the
// real ~/.claude.
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "clawline-test-"));
  process.env.CLAUDE_CONFIG_DIR = dir;
  return dir;
}

const fresh = async () => {
  const stamp = Date.now() + Math.random();
  return {
    config: await import(`../src/config.mjs?${stamp}`),
    install: await import(`../src/install.mjs?${stamp}`),
  };
};

test("defaults enable the five must-have segments across two rows", async () => {
  sandbox();
  const { config: cfg } = await fresh();
  const d = cfg.defaults();
  assert.equal(d.rows.length, 2);
  const ids = d.rows.flat();
  for (const must of ["model", "mode", "context", "rate-5h", "rate-week"]) {
    assert.ok(ids.includes(must), `${must} on by default`);
  }
  assert.equal(d.theme, "dark");
});

test("user config overrides defaults, project config overrides the user", async () => {
  const dir = sandbox();
  const { config: cfg } = await fresh();
  writeFileSync(join(dir, "clawline.json"), JSON.stringify({ theme: "nord", rows: [["model"]] }));

  const projectDir = mkdtempSync(join(tmpdir(), "clawline-proj-"));
  writeFileSync(join(projectDir, ".clawline.json"), JSON.stringify({ rows: [["cost", "diff"]] }));

  const { config, sources } = cfg.loadConfig(projectDir);
  assert.equal(config.theme, "nord");
  assert.deepEqual(config.rows, [["cost", "diff"]]);
  assert.equal(sources.length, 2);
});

test("segment options merge instead of replacing", async () => {
  const dir = sandbox();
  const { config: cfg } = await fresh();
  writeFileSync(
    join(dir, "clawline.json"),
    JSON.stringify({ segments: { context: { width: 20 } } }),
  );
  const { config } = cfg.loadConfig(process.cwd());
  const opts = cfg.segmentOptions(config, "context");
  assert.equal(opts.width, 20);
  assert.equal(opts.glyphs, "blocks", "untouched option keeps its default");
  assert.equal(opts.showTokens, true);
});

test("invalid config is reported, not fatal", async () => {
  const dir = sandbox();
  const { config: cfg } = await fresh();
  writeFileSync(join(dir, "clawline.json"), "{ not json");
  const { config, warnings } = cfg.loadConfig(process.cwd());
  assert.ok(warnings.some((w) => w.startsWith("user config:")));
  assert.equal(config.theme, "dark");
});

test("unknown theme and unknown segment produce warnings", async () => {
  const dir = sandbox();
  const { config: cfg } = await fresh();
  writeFileSync(
    join(dir, "clawline.json"),
    JSON.stringify({ theme: "vaporwave", rows: [["model", "nope"]] }),
  );
  const { config, warnings } = cfg.loadConfig(process.cwd());
  assert.equal(config.theme, "dark");
  assert.ok(warnings.some((w) => w.includes("vaporwave")));
  assert.ok(warnings.some((w) => w.includes("nope")));
});

test("saved config holds only what differs from the defaults", async () => {
  const dir = sandbox();
  const { config: cfg } = await fresh();
  const { config } = cfg.loadConfig(process.cwd());
  config.theme = "nord";
  config.rows = [["model", "context"]];
  config.segments.context.width = 16;
  const path = cfg.saveConfig(config, { scope: "user" });
  const written = JSON.parse(readFileSync(path, "utf8"));

  assert.equal(path, join(dir, "clawline.json"));
  assert.equal(written.theme, "nord");
  assert.deepEqual(written.rows, [["model", "context"]]);
  assert.deepEqual(written.segments, { context: { width: 16 } });
  assert.equal(written.separator, undefined, "unchanged keys are not written");

  const reloaded = cfg.loadConfig(process.cwd()).config;
  assert.equal(cfg.segmentOptions(reloaded, "context").width, 16);
});

test("install writes a forward-slash command and keeps other settings", async () => {
  const dir = sandbox();
  const { config: cfg, install: inst } = await fresh();
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ theme: "dark", model: "opus" }, null, 2));

  const { config } = cfg.loadConfig(process.cwd());
  const res = inst.install(config, { scope: "user" });
  const settings = JSON.parse(readFileSync(res.path, "utf8"));

  assert.equal(settings.model, "opus", "untouched keys survive");
  assert.equal(settings.statusLine.type, "command");
  assert.ok(!settings.statusLine.command.includes("\\"), "no backslashes for Git Bash");
  assert.equal(settings.statusLine.refreshInterval, 10, "time-based segments ask for a timer");
  assert.ok(existsSync(res.backup), "settings were backed up");
});

test("no refresh timer when nothing time-based is enabled", async () => {
  sandbox();
  const { config: cfg, install: inst } = await fresh();
  const config = { ...cfg.defaults(), rows: [["model", "dir", "context"]] };
  assert.equal(inst.statusLineEntry(config).refreshInterval, undefined);
  assert.equal(inst.statusLineEntry({ ...config, rows: [["burn"]] }).refreshInterval, 10);
});

test("uninstall removes only the statusLine key", async () => {
  const dir = sandbox();
  const { config: cfg, install: inst } = await fresh();
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ model: "opus" }, null, 2));
  const { config } = cfg.loadConfig(process.cwd());
  inst.install(config, { scope: "user" });

  const res = inst.uninstall({ scope: "user" });
  assert.equal(res.removed, true);
  const settings = JSON.parse(readFileSync(res.path, "utf8"));
  assert.equal(settings.statusLine, undefined);
  assert.equal(settings.model, "opus");
  assert.equal(inst.uninstall({ scope: "user" }).removed, false, "second uninstall is a no-op");
});

test("project scope writes .claude/settings.json next to the code", async () => {
  sandbox();
  const { config: cfg, install: inst } = await fresh();
  const projectDir = mkdtempSync(join(tmpdir(), "clawline-proj-"));
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  const { config } = cfg.loadConfig(projectDir);
  const res = inst.install(config, { scope: "project", cwd: projectDir });
  assert.equal(res.path, join(projectDir, ".claude", "settings.json"));
  assert.ok(existsSync(res.path));
});

test("malformed settings.json is refused instead of overwritten", async () => {
  const dir = sandbox();
  const { config: cfg, install: inst } = await fresh();
  writeFileSync(join(dir, "settings.json"), "{ broken");
  const { config } = cfg.loadConfig(process.cwd());
  assert.throws(() => inst.install(config, { scope: "user" }), /not valid JSON/);
  assert.equal(readFileSync(join(dir, "settings.json"), "utf8"), "{ broken");
});

test("the render command never goes through npx", async () => {
  const dir = sandbox();
  const { install: inst } = await fresh();
  const npxBin = "/home/u/.npm/_npx/0faab9cd/node_modules/clawline/bin/clawline.mjs";
  assert.equal(inst.commandString(npxBin), `node "${inst.toPosix(join(dir, "clawline-app", "bin", "clawline.mjs"))}" --render`);
  assert.equal(inst.commandString("/opt/my tools/clawline/bin/clawline.mjs"), 'node "/opt/my tools/clawline/bin/clawline.mjs" --render', "quoted, so spaces survive");
  assert.equal(inst.commandString("C:\\Users\\a b\\clawline\\bin\\clawline.mjs"), 'node "C:/Users/a b/clawline/bin/clawline.mjs" --render');
  assert.ok(inst.fromNpx("C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\ab12\\node_modules\\clawline"));
  assert.ok(!inst.fromNpx("/usr/lib/node_modules/clawline/bin/clawline.mjs"), "a global install is used in place");
});

test("an npx install copies a working app out of the npm cache", async () => {
  const { execFileSync } = await import("node:child_process");
  sandbox();
  const { install: inst } = await fresh();
  const to = inst.copyApp();
  inst.copyApp(); // a second install replaces the copy instead of failing
  const out = execFileSync("node", [join(to, "bin", "clawline.mjs"), "--render"], {
    input: readFileSync(new URL("./fixtures/mid-session.json", import.meta.url)),
    env: { ...process.env, NO_COLOR: "1", COLUMNS: "120" },
    encoding: "utf8",
  });
  assert.match(out, /Opus·xhigh/);
  assert.equal(out.trim().split("\n").length, 2);
});

test("schema.json matches the segment registry (run node scripts/gen-schema.mjs)", async () => {
  const { SEGMENTS } = await import("../src/segments/index.mjs");
  const schema = JSON.parse(readFileSync(new URL("../schema.json", import.meta.url), "utf8"));
  const listed = schema.properties.segments.properties;
  assert.deepEqual(Object.keys(listed).sort(), SEGMENTS.map((s) => s.id).sort(), "every segment, no strays");
  for (const s of SEGMENTS) {
    assert.deepEqual(Object.keys(listed[s.id].properties).sort(), Object.keys(s.options || {}).sort(), `${s.id} options`);
  }
});
