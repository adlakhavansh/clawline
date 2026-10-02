import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render, withIcon } from "../src/render.mjs";
import { defaults, validate, serialize } from "../src/config.mjs";
import { layout, bgToFg, STYLE_NAMES, FILL } from "../src/style.mjs";
import { strip, width, bar } from "../src/ansi.mjs";
import { getTheme, THEME_NAMES } from "../src/theme.mjs";
import { applyEdit, parseEdits } from "../src/edit.mjs";
import { previewLines } from "../src/tui.mjs";
import { SEGMENTS } from "../src/segments/index.mjs";

const fixture = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), "utf8"));
const FIXTURES = ["fresh-session", "mid-session", "post-compact", "big-context"];

const lookC = (patch = {}) => ({
  ...defaults(),
  style: "minimal",
  icons: "nerd",
  rows: [
    ["model", "mode", "dir", "git", "fill", "cost", "burn", "cache"],
    ["context", "tips", "fill", "rate-5h", "rate-week"],
  ],
  ...patch,
});

// Walks the SGR codes and reports the background behind every visible character.
function cells(line) {
  const out = [];
  let bg = "";
  const re = /\u001b\[([0-9;]*)m|\u001b\]8;[^\u0007]*\u0007|([\s\S])/gu;
  for (const m of line.matchAll(re)) {
    if (m[2] !== undefined) {
      out.push({ ch: m[2], bg });
      continue;
    }
    if (m[1] === undefined) continue;
    const codes = m[1] === "" ? ["0"] : m[1].split(";");
    for (let i = 0; i < codes.length; i += 1) {
      const c = Number(codes[i]);
      if (c === 0 || c === 49) bg = "";
      else if (c === 7) bg = "reverse";
      else if (c === 48) {
        bg = codes[i + 1] === "5" ? `5;${codes[i + 2]}` : `2;${codes.slice(i + 2, i + 5).join(";")}`;
        i += codes[i + 1] === "5" ? 2 : 4;
      } else if (c === 38) i += codes[i + 1] === "5" ? 2 : 4;
      else if ((c >= 40 && c <= 47) || (c >= 100 && c <= 107)) bg = String(c);
    }
  }
  return out;
}

test("plain is the default and draws no backgrounds and no icons", () => {
  const d = defaults();
  assert.equal(d.style, "plain");
  assert.equal(d.icons, "none");
  for (const name of FIXTURES) {
    for (const row of render(fixture(name), { config: d, columns: 120 })) {
      assert.ok(cells(row).every((c) => c.bg === ""), `${name}: no background anywhere`);
      assert.doesNotMatch(strip(row), /[-]|[\u{F0000}-\u{FFFFD}]/u, `${name}: no Nerd glyphs`);
    }
  }
  const saved = serialize(d);
  assert.equal("style" in saved, false, "defaults stay out of the saved file");
  assert.equal("icons" in saved, false);
});

test("minimal joins segments with a thin rule and keeps the separator spacing", () => {
  const rows = render(fixture("mid-session"), { config: { ...defaults(), style: "minimal" }, columns: 160 });
  assert.match(strip(rows[0]), /Opus·xhigh {2}│ {2}plan {2}│ {2}clawline/);
  const tight = render(fixture("mid-session"), {
    config: { ...defaults(), style: "minimal", separator: " " },
    columns: 160,
  });
  assert.match(strip(tight[0]), /Opus·xhigh │ plan │ clawline/);
});

test("fill pushes everything after it to the right edge", () => {
  for (const style of STYLE_NAMES) {
    const rows = render(fixture("mid-session"), { config: lookC({ style }), columns: 140 });
    for (const row of rows) assert.equal(width(row), 138, `${style}: a row with fill spans the budget`);
    assert.match(strip(rows[1]), /41%[ \u{E0B4}]*$/u, `${style}: the weekly window ends the row`);
  }
});

test("powerline keeps every cell of a block on its background", () => {
  const theme = getTheme("dark");
  const [row] = render(fixture("big-context"), {
    config: { ...defaults(), style: "powerline", rows: [["model", "mode", "dir", "context", "rate-5h"]] },
    columns: 200,
  });
  const drawn = cells(row);
  const arrows = drawn.map((c, i) => (c.ch === "\u{E0B0}" ? i : -1)).filter((i) => i >= 0);
  assert.equal(arrows.length, 5, "one arrow after each block");
  let start = 0;
  for (const end of arrows) {
    const block = drawn.slice(start, end);
    assert.ok(block.length > 2, "block has content");
    assert.ok(block.every((c) => c.bg !== ""), `block "${block.map((c) => c.ch).join("")}" never loses its background`);
    start = end + 1;
  }
  assert.equal(drawn[drawn.length - 1].bg, "", "the last arrow sits on the terminal background");
  assert.equal(drawn[0].bg, "5;117", "model gets the accent");
  assert.equal(drawn[arrows[0] + 1].bg, theme.bg.base.slice(3), "then base");
  assert.equal(drawn[arrows[1] + 1].bg, theme.bg.alt.slice(3), "then alt");
});

test("powerline points the right-hand group the other way", () => {
  const [row] = render(fixture("mid-session"), {
    config: { ...defaults(), style: "powerline", rows: [["model", "fill", "cost", "context"]] },
    columns: 120,
  });
  const plain = strip(row);
  assert.match(plain, /\u{E0B0} +\u{E0B2}/u, "left group closes right, right group opens left");
  assert.equal(width(row), 118);
});

test("capsules wrap each segment in rounded caps of its own colour", () => {
  const [row] = render(fixture("mid-session"), {
    config: { ...defaults(), style: "capsule", rows: [["model", "mode", "cost"]] },
    columns: 120,
  });
  assert.equal((strip(row).match(/\u{E0B6}/gu) || []).length, 3);
  assert.equal((strip(row).match(/\u{E0B4}/gu) || []).length, 3);
  for (const c of cells(row)) {
    if (c.ch === " " || c.ch === "\u{E0B6}" || c.ch === "\u{E0B4}") continue;
    assert.notEqual(c.bg, "", `"${c.ch}" sits inside a pill`);
  }
});

test("every theme can draw every style", () => {
  for (const theme of THEME_NAMES) {
    for (const style of STYLE_NAMES) {
      for (const name of FIXTURES) {
        const rows = render(fixture(name), { config: lookC({ theme, style }), columns: 100 });
        assert.ok(rows.length >= 1, `${theme}/${style}/${name}`);
        for (const row of rows) assert.ok(width(row) <= 98, `${theme}/${style}/${name} fits`);
      }
    }
  }
});

test("rows fit the terminal at every width, in every style", () => {
  for (const style of STYLE_NAMES) {
    for (const name of FIXTURES) {
      for (const columns of [200, 120, 90, 60, 40, 24]) {
        for (const row of render(fixture(name), { config: lookC({ style }), columns })) {
          assert.ok(width(row) <= columns - 2, `${style}/${name}@${columns}: ${width(row)} cells`);
        }
      }
    }
  }
});

test("a data segment is dropped whole, never cut to a stub", () => {
  const theme = getTheme("dark");
  const items = [
    { id: "model", text: "Opus·xhigh", priority: 9 },
    { id: "cache", text: "cache 91%", priority: 4 },
    { id: "tips", text: "tip esc esc rewinds the conversation", priority: 1, shrinks: 16 },
  ];
  const fit = (columns) => strip(layout(structuredClone(items), { style: "plain", theme, config: {}, columns }));
  assert.equal(fit(80), "Opus·xhigh  cache 91%  tip esc esc rewinds the conversation");
  assert.equal(fit(40), "Opus·xhigh  cache 91%  tip esc esc rewi…", "the tip shrinks first");
  assert.equal(fit(30), "Opus·xhigh  cache 91%", "too little room for a useful tip: dropped");
  assert.equal(fit(18), "Opus·xhigh", "cache goes whole");
  assert.equal(fit(6), "Opus·…", "the last one standing is cut rather than lost");
});

test("equal priority gives way right to left", () => {
  const items = ["a1", "a2", "a3"].map((id) => ({ id, text: `${id}xxxxxx`, priority: 5 }));
  assert.equal(strip(layout(items, { style: "plain", theme: { sep: "" }, config: {}, columns: 18 })), "a1xxxxxx  a2xxxxxx");
});

test("nerd icons take the colour the segment opens with", () => {
  const theme = getTheme("dark");
  const text = `\u001b[${theme.model}mOpus\u001b[0m`;
  assert.equal(withIcon("model", text, { icons: "none" }), text);
  assert.equal(withIcon("model", text, { icons: "nerd" }), `\u001b[${theme.model}m\u{F06A9}\u001b[0m ${text}`);
  assert.equal(withIcon("fill", "x", { icons: "nerd" }), "x", "no icon, no change");
  for (const s of SEGMENTS) {
    assert.equal(typeof s.icon, "string", `${s.id} icon`);
    assert.equal(typeof s.priority, "number", `${s.id} priority`);
  }
});

test("smooth bars use eighth blocks and always fill their width", () => {
  const track = getTheme("dark").track;
  assert.equal(strip(bar(38, { width: 10, glyphs: "smooth", color: "32", track })), "███▊      ");
  assert.equal(strip(bar(0, { width: 6, glyphs: "smooth", color: "32", track })), "      ");
  assert.equal(strip(bar(100, { width: 6, glyphs: "smooth", color: "32", track })), "██████");
  for (let pct = 0; pct <= 100; pct += 1) {
    assert.equal(width(bar(pct, { width: 12, glyphs: "smooth", color: "32", track })), 12, `${pct}%`);
  }
  assert.equal(strip(bar(38, { width: 10, glyphs: "smooth", color: "32" })), "███▊░░░░░░", "no track: shaded");
});

test("a bar's width is kept between 1 and 200 cells", () => {
  for (const glyphs of ["blocks", "smooth"]) {
    assert.equal(width(bar(50, { width: -5, glyphs })), 1, `${glyphs} negative`);
    assert.equal(width(bar(50, { width: 1e9, glyphs })), 200, `${glyphs} huge`);
    assert.equal(width(bar(50, { width: "abc", glyphs })), 10, `${glyphs} not a number`);
  }
});

test("NO_COLOR leaves no escape in any style", () => {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    for (const style of STYLE_NAMES) {
      for (const row of render(fixture("mid-session"), { config: lookC({ style }), columns: 140 })) {
        assert.equal(row, strip(row), style);
      }
    }
    assert.equal(bar(38, { width: 10, glyphs: "smooth", color: "32", track: "48;5;237" }), "███▊░░░░░░");
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
});

test("background codes turn into the matching foreground for arrows and caps", () => {
  assert.equal(bgToFg("48;5;236"), "38;5;236");
  assert.equal(bgToFg("48;2;26;27;38"), "38;2;26;27;38");
  assert.equal(bgToFg("44"), "34");
  assert.equal(bgToFg("104"), "94");
  assert.equal(bgToFg("7"), "", "reverse video has no colour to hand over");
  assert.equal(bgToFg(""), "");
});

test("style and icons are validated, edited and saved like the theme", () => {
  const config = defaults();
  for (const edit of parseEdits(["--style", "powerline", "--icons", "nerd"])) applyEdit(config, edit);
  assert.equal(config.style, "powerline");
  assert.equal(config.icons, "nerd");
  assert.deepEqual(
    { style: serialize(config).style, icons: serialize(config).icons },
    { style: "powerline", icons: "nerd" },
  );
  assert.throws(() => applyEdit(config, { kind: "style", style: "neon" }), /unknown style "neon"/);
  assert.throws(() => applyEdit(config, { kind: "icons", icons: "emoji" }), /icons is none or nerd/);
  assert.throws(() => parseEdits(["--style"]), /--style needs a name/);

  const broken = { ...defaults(), style: "neon", icons: "emoji" };
  const warnings = validate(broken);
  assert.ok(warnings.some((w) => w.includes('unknown style "neon"')));
  assert.ok(warnings.some((w) => w.includes('unknown icons "emoji"')));
  assert.equal(broken.style, "plain");
  assert.equal(broken.icons, "none");
});

test("fill is a segment the picker and the edit flags already know", () => {
  const config = defaults();
  applyEdit(config, { kind: "on", id: FILL });
  assert.ok(config.rows.flat().includes(FILL));
  const lines = previewLines(lookC().rows, { theme: "dark", style: "powerline", icons: "nerd" }, 120);
  assert.equal(lines.length, 2);
  for (const line of lines) assert.equal(width(line), 116, "the preview uses the real layout, fill included");
});

test("a styled render stays under 100ms", () => {
  const data = fixture("mid-session");
  for (const style of STYLE_NAMES) {
    render(data, { config: lookC({ style }), columns: 160 });
    const started = process.hrtime.bigint();
    render(data, { config: lookC({ style }), columns: 160 });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 100, `${style} took ${ms.toFixed(1)}ms`);
  }
});

test("a narrow terminal keeps the warnings and loses the stubs", () => {
  const at = (name, columns) => render(fixture(name), { config: defaults(), columns }).map(strip);
  assert.match(at("big-context", 30)[0], /bypass/, "a shortened mode still says bypass");
  assert.match(at("post-compact", 45)[1], /wk 91%/, "a shortened weekly window keeps its number");
  assert.doesNotMatch(at("mid-session", 60)[1], /tip/, "no 'tip plan …' stub");
});
