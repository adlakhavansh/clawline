import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render, fitRow, renderSegment } from "../src/render.mjs";
import { defaults } from "../src/config.mjs";
import { strip, width, truncate, humanTokens, humanDuration, humanMoney, untilEpoch } from "../src/ansi.mjs";
import { getTheme, loadRole } from "../src/theme.mjs";
import { contextUsage } from "../src/segments/usage.mjs";
import { parsePorcelainV2 } from "../src/git.mjs";
import { permissionMode } from "../src/transcript.mjs";
import { SEGMENTS, BY_ID } from "../src/segments/index.mjs";

const fixture = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), "utf8"));
const fixturePath = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const configWith = (rows, patch = {}) => ({ ...defaults(), rows, ...patch });

test("every segment has the registry shape", () => {
  for (const s of SEGMENTS) {
    assert.equal(typeof s.id, "string", "id");
    assert.equal(typeof s.hint, "string", `${s.id} hint`);
    assert.equal(typeof s.render, "function", `${s.id} render`);
    assert.equal(typeof s.sample, "function", `${s.id} sample`);
    assert.equal(typeof s.sample(getTheme("dark")), "string", `${s.id} sample output`);
  }
  assert.equal(BY_ID.size, SEGMENTS.length, "ids are unique");
});

test("mid-session renders both rows with the user's must-haves", () => {
  const rows = render(fixture("mid-session"), { config: defaults(), columns: 120 });
  assert.equal(rows.length, 2);
  const plain = rows.map(strip).join("\n");
  assert.match(plain, /Opus·xhigh/);
  assert.match(plain, /38%/);
  assert.match(plain, /77k\/200k/);
  assert.match(plain, /5h 24%/);
  assert.match(plain, /wk 41%/);
  assert.match(plain, /\$1\.23/);
});

test("permission mode comes from the transcript", () => {
  assert.equal(permissionMode(fixturePath("transcript-plan.jsonl")), "plan");
  assert.equal(permissionMode(fixturePath("transcript-auto.jsonl")), "auto");
  assert.equal(permissionMode(fixturePath("transcript-bypass.jsonl")), "bypass");
  assert.equal(permissionMode(fixturePath("missing.jsonl")), "");
  assert.equal(permissionMode(undefined), "");
});

test("a fresh session with no usage data still renders", () => {
  const rows = render(fixture("fresh-session"), { config: defaults(), columns: 120 });
  assert.ok(rows.length >= 1);
  assert.doesNotMatch(strip(rows.join("\n")), /NaN|undefined|null/);
});

test("null current_usage after a compact does not throw or print NaN", () => {
  const data = fixture("post-compact");
  data.context_window.total_input_tokens = null;
  const { used, pct } = contextUsage(data);
  assert.equal(used, null);
  assert.equal(pct, null);
  const line = renderSegment("context", {
    data,
    config: defaults(),
    theme: getTheme("dark"),
    cwd: process.cwd(),
    columns: 80,
  });
  assert.match(strip(line), /—/);
});

test("missing rate_limits yields empty segments, not errors", () => {
  const data = fixture("fresh-session");
  const config = configWith([["rate-5h", "rate-week"]]);
  assert.deepEqual(render(data, { config, columns: 120 }), []);
});

test("a 1M context window is labelled in millions and flagged past the warn mark", () => {
  const line = strip(
    renderSegment("context", {
      data: fixture("big-context"),
      config: defaults(),
      theme: getTheme("dark"),
      cwd: process.cwd(),
      columns: 80,
    }),
  );
  assert.match(line, /93%/);
  assert.match(line, /930k\/1\.0M/);
  assert.match(line, /!$/);
});

test("spend limit shows up next to the weekly window", () => {
  const line = strip(
    renderSegment("rate-week", {
      data: fixture("post-compact"),
      config: defaults(),
      theme: getTheme("dark"),
      cwd: process.cwd(),
      columns: 80,
    }),
  );
  assert.match(line, /wk 91%/);
  assert.match(line, /spend 63%/);
});

test("the bar can move from context to the rate limit", () => {
  const data = fixture("mid-session");
  const config = {
    ...defaults(),
    rows: [["rate-5h", "context"]],
    segments: {
      ...defaults().segments,
      "rate-5h": { ...defaults().segments["rate-5h"], bar: true },
      context: { ...defaults().segments.context, bar: false },
    },
  };
  const theme = getTheme("dark");
  const rate = strip(renderSegment("rate-5h", { data, config, theme, cwd: process.cwd(), columns: 80 }));
  const ctx = strip(renderSegment("context", { data, config, theme, cwd: process.cwd(), columns: 80 }));
  assert.match(rate, /^5h [█░]{10} 24%/);
  assert.doesNotMatch(ctx, /[█░]/);
  assert.match(ctx, /^38% 77k\/200k$/);
});

test("time-rotated tips advance once per rotateSeconds", () => {
  const data = { ...fixture("mid-session"), transcript_path: "", rate_limits: {}, prompt_cache: {} };
  data.context_window = { ...data.context_window, used_percentage: 10 };
  const config = {
    ...defaults(),
    segments: {
      ...defaults().segments,
      tips: { ...defaults().segments.tips, contextAware: false, rotate: "time", rotateSeconds: 30 },
    },
  };
  const theme = getTheme("dark");
  const at = (offset) => {
    const real = Date.now;
    Date.now = () => 1_800_000_000_000 + offset;
    try {
      return strip(renderSegment("tips", { data, config, theme, cwd: process.cwd(), columns: 120 }));
    } finally {
      Date.now = real;
    }
  };
  assert.equal(at(0), at(29_000), "holds steady inside the window");
  assert.notEqual(at(0), at(30_000), "changes at the boundary");
  assert.notEqual(at(30_000), at(60_000));
});

const withOptions = (patch) => {
  const base = defaults();
  const segments = { ...base.segments };
  for (const [id, opts] of Object.entries(patch)) segments[id] = { ...segments[id], ...opts };
  return { ...base, segments };
};

const one = (id, data, config) =>
  strip(renderSegment(id, { data, config, theme: getTheme("dark"), cwd: process.cwd(), columns: 120 }));

test("quiet mode hides ordinary permission modes and keeps the risky ones", () => {
  const config = withOptions({ mode: { quiet: true } });
  const path = (name) => fixturePath(`transcript-${name}.jsonl`);
  assert.equal(one("mode", { transcript_path: path("auto") }, config), "", "auto is silent");
  assert.equal(one("mode", { transcript_path: path("plan") }, config), "plan");
  assert.equal(one("mode", { transcript_path: path("bypass") }, config), "bypass");
  assert.equal(one("mode", { transcript_path: path("auto") }, defaults()), "auto", "default is loud");
});

test("context takes a label and the rate limits put their bar after theirs", () => {
  const data = fixture("mid-session");
  const config = withOptions({
    context: { label: "ctx", bar: true, showTokens: false },
    "rate-5h": { bar: true, showReset: false },
  });
  assert.match(one("context", data, config), /^ctx [█░]{10} 38%$/);
  assert.match(one("rate-5h", data, config), /^5h [█░]{10} 24%$/);
});

test("tokens in window style prints used out of the window size", () => {
  const config = withOptions({ tokens: { style: "window" } });
  assert.equal(one("tokens", fixture("mid-session"), config), "77k/200k");
  assert.equal(one("tokens", fixture("big-context"), config), "930k/1.0M");
  assert.equal(one("tokens", fixture("post-compact"), config), "0/200k", "reads zero after a compact");
  const noWindow = { ...fixture("post-compact"), context_window: { context_window_size: 200000 } };
  assert.equal(one("tokens", noWindow, config), "", "nothing at all before the first call");
});

test("the twin-bar layout renders as designed", () => {
  const config = {
    ...withOptions({
      mode: { quiet: true },
      context: { label: "ctx", bar: true, showTokens: false },
      "rate-5h": { bar: true, showReset: false },
      tokens: { style: "window" },
    }),
    rows: [
      ["model", "mode", "dir", "git", "context", "rate-5h"],
      ["tokens", "rate-week", "cost", "tips"],
    ],
  };
  const rows = render(fixture("mid-session"), { config, columns: 150 }).map(strip);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /Opus·xhigh.+clawline.+ctx [█░]{10} 38%\s+5h [█░]{10} 24%$/);
  assert.doesNotMatch(rows[0], /\bauto\b/);
  assert.match(rows[1], /^77k\/200k\s+wk 41%/);
  assert.match(rows[1], /\$1\.23/);
  assert.match(rows[1], /tip /);
});

test("segments without data return an empty string", () => {
  const theme = getTheme("dark");
  for (const id of ["pr", "diff", "cache", "tokens", "custom", "text", "burn"]) {
    const line = renderSegment(id, {
      data: { session_id: "empty-test" },
      config: defaults(),
      theme,
      cwd: process.cwd(),
      columns: 80,
    });
    assert.equal(line, "", id);
  }
});

test("a throwing segment is swallowed instead of killing the line", () => {
  const original = BY_ID.get("text").render;
  BY_ID.get("text").render = () => {
    throw new Error("boom");
  };
  try {
    const line = renderSegment("text", {
      data: {},
      config: defaults(),
      theme: getTheme("dark"),
      cwd: process.cwd(),
      columns: 80,
    });
    assert.equal(line, "");
  } finally {
    BY_ID.get("text").render = original;
  }
});

test("unknown segment ids render as nothing", () => {
  const config = configWith([["model", "not-a-segment"]]);
  const rows = render(fixture("mid-session"), { config, columns: 120 });
  assert.equal(rows.length, 1);
  assert.equal(strip(rows[0]).includes("not-a-segment"), false);
});

test("rows are fitted to the terminal width", () => {
  for (const columns of [120, 60, 40, 24]) {
    for (const row of render(fixture("big-context"), { config: defaults(), columns })) {
      assert.ok(width(row) <= columns - 2, `row of ${width(row)} cells exceeds ${columns}`);
    }
  }
});

test("fitRow shortens the last segment before dropping it", () => {
  const parts = ["aaaa", "bbbb", "cccccccccccccccccccc"];
  const fitted = fitRow(parts, "  ", 24);
  assert.match(strip(fitted), /^aaaa {2}bbbb {2}c+…$/);
  const tight = fitRow(parts, "  ", 12);
  assert.equal(strip(tight), "aaaa  bbbb");
});

test("ANSI-aware width and truncation", () => {
  const colored = `\u001b[36mhello world\u001b[0m`;
  assert.equal(width(colored), 11);
  assert.equal(width(truncate(colored, 8)), 8);
  assert.equal(width("日本語"), 6);
});

test("number and time formatting", () => {
  assert.equal(humanTokens(999), "999");
  assert.equal(humanTokens(8500), "8.5k");
  assert.equal(humanTokens(76500), "77k");
  assert.equal(humanTokens(1_250_000), "1.3M");
  assert.equal(humanDuration(0), "0s");
  assert.equal(humanDuration(45_000), "45s");
  assert.equal(humanDuration(3_785_000), "1h03m");
  assert.equal(humanDuration(90_000_000), "1d1h");
  assert.equal(humanMoney(0.5), "$0.50");
  assert.equal(humanMoney(12.34), "$12.3");
  assert.equal(humanMoney(120.4), "$120");
  assert.equal(untilEpoch(0), "");
  assert.equal(untilEpoch(Math.floor(Date.now() / 1000) - 10), "");
  assert.equal(untilEpoch(9_999_999_999), "", "garbage deadlines are dropped");
  assert.match(untilEpoch(Math.floor(Date.now() / 1000) + 7860), /^2h1\dm$/);
});

test("the load ramp is shared by context and rate limits", () => {
  assert.equal(loadRole(10), "good");
  assert.equal(loadRole(60), "warn");
  assert.equal(loadRole(80), "bad");
  assert.equal(loadRole(95), "crit");
});

test("porcelain v2 parsing", () => {
  const out = [
    "# branch.oid 1234567890abcdef",
    "# branch.head main",
    "# branch.upstream origin/main",
    "# branch.ab +2 -1",
    "1 .M N... 100644 100644 100644 aaa bbb file-unstaged.js",
    "1 M. N... 100644 100644 100644 aaa bbb file-staged.js",
    "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.js",
    "? untracked.js",
    "",
  ].join("\n");
  const g = parsePorcelainV2(out);
  assert.equal(g.branch, "main");
  assert.equal(g.sha, "1234567");
  assert.equal(g.ahead, 2);
  assert.equal(g.behind, 1);
  assert.equal(g.staged, 1);
  assert.equal(g.unstaged, 1);
  assert.equal(g.conflicts, 1);
  assert.equal(g.untracked, 1);

  const detached = parsePorcelainV2("# branch.oid abcdef1234\n# branch.head (detached)\n");
  assert.equal(detached.detached, true);
  assert.equal(detached.branch, "@abcdef1");
});

test("NO_COLOR strips every escape", async () => {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const rows = render(fixture("mid-session"), { config: defaults(), columns: 120 });
    for (const row of rows) assert.equal(row, strip(row));
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
});

test("render stays under 100ms on a warm cache", () => {
  const data = fixture("mid-session");
  render(data, { config: defaults(), columns: 120 }); // warm the git cache
  const started = process.hrtime.bigint();
  render(data, { config: defaults(), columns: 120 });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 100, `render took ${ms.toFixed(1)}ms`);
});

// Renders under a faked clock leave cache entries stamped in the future. Each cache has to
// treat those as stale, or it serves them until the real clock catches up.
const fromTheFuture = (fn) => {
  const real = Date.now;
  Date.now = () => real() + 100 * 86_400_000;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
};

test("git state cached in the future is read again", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { gitState } = await import("../src/git.mjs");
  const repo = mkdtempSync(join(tmpdir(), "clawline-git-"));
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("checkout", "-q", "-b", "before");
  assert.equal(fromTheFuture(() => gitState(repo)).branch, "before");
  git("checkout", "-q", "-b", "after");
  assert.equal(gitState(repo).branch, "after");
});

test("a custom command cached in the future runs again", async () => {
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "clawline-custom-"));
  writeFileSync(join(dir, "out"), "before");
  const config = { ...defaults(), segments: { ...defaults().segments, custom: { command: "cat out", ttl: 30 } } };
  const run = () => strip(renderSegment("custom", { data: {}, config, theme: getTheme("dark"), cwd: dir, columns: 80 }));
  assert.equal(fromTheFuture(run), "before");
  writeFileSync(join(dir, "out"), "after");
  assert.equal(run(), "after");
});

test("a rate sample from the future does not freeze the rate", async () => {
  const { rates } = await import("../src/state.mjs");
  const id = `future-${process.pid}-${Date.now()}`;
  fromTheFuture(() => rates(id, { tokens: 0 }));
  rates(id, { tokens: 1000 });
  const real = Date.now;
  const now = real();
  Date.now = () => now + 60_000;
  try {
    assert.equal(rates(id, { tokens: 7000 }).tokensPerMin, 6000);
  } finally {
    Date.now = real;
  }
});
