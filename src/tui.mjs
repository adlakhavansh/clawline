// Checkbox picker. Raw-mode stdin, no dependencies, no menu trees: one flat list of every
// segment, with the row it sits in and a live sample beside it.

import { paint, truncate } from "./ansi.mjs";
import { getTheme, THEME_NAMES } from "./theme.mjs";
import { SEGMENTS, BY_ID } from "./segments/index.mjs";
import { loadConfig, saveConfig } from "./config.mjs";
import { install, commandString } from "./install.mjs";
import { layout, FILL, STYLE_NAMES } from "./style.mjs";
import { withIcon } from "./render.mjs";

const ALT_ON = "\u001b[?1049h";
const ALT_OFF = "\u001b[?1049l";
const CLEAR = "\u001b[2J\u001b[H";
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";

const out = (s) => process.stdout.write(s);

function rowOf(rows, id) {
  for (let i = 0; i < rows.length; i += 1) if (rows[i].includes(id)) return i;
  return -1;
}

function removeId(rows, id) {
  for (const row of rows) {
    const i = row.indexOf(id);
    if (i >= 0) row.splice(i, 1);
  }
}

function assign(rows, id, rowIndex) {
  removeId(rows, id);
  while (rows.length <= rowIndex) rows.push([]);
  rows[rowIndex].push(id);
}

function move(rows, id, delta) {
  const r = rowOf(rows, id);
  if (r < 0) return;
  const row = rows[r];
  const i = row.indexOf(id);
  const j = i + delta;
  if (j < 0 || j >= row.length) return;
  [row[i], row[j]] = [row[j], row[i]];
}

// The preview goes through the same layout as the real line, so style, icons and fill show.
function previewLines(rows, look, columns) {
  const theme = getTheme(look.theme);
  return rows
    .map((row) => {
      const items = row
        .map((id) => {
          if (id === FILL) return { id };
          const s = BY_ID.get(id);
          if (!s) return null;
          let text;
          try {
            text = s.sample(theme);
          } catch {
            text = id;
          }
          return text ? { id, text: withIcon(id, text, look), priority: s.priority, shrinks: s.shrinks } : null;
        })
        .filter(Boolean);
      if (!items.some((i) => i.id !== FILL)) return "";
      return layout(items, { style: look.style, theme, config: look, columns: columns - 4 });
    })
    .filter(Boolean);
}

function draw(state) {
  const { rows, themeName, style, icons, cursor, scope } = state;
  const theme = getTheme(themeName);
  const columns = process.stdout.columns || 100;
  const lines = [];

  lines.push(
    paint("1", "clawline") +
      paint(theme.muted, "  pick your segments") +
      paint(theme.muted, `   theme ${themeName} · style ${style} · icons ${icons} · rows ${rows.length} · ${scope} config`),
  );
  lines.push("");

  const labelWidth = Math.max(...SEGMENTS.map((s) => s.id.length)) + 2;
  SEGMENTS.forEach((segment, i) => {
    const r = rowOf(rows, segment.id);
    const on = r >= 0;
    const marker = i === cursor ? paint(theme.model, "›") : " ";
    const box = on ? paint(theme.good, "[x]") : paint(theme.muted, "[ ]");
    const rowTag = on ? paint(theme.muted, String(r + 1)) : paint(theme.muted, "-");
    const name = on ? segment.id.padEnd(labelWidth) : paint(theme.muted, segment.id.padEnd(labelWidth));
    let sample;
    try {
      sample = segment.sample(theme);
    } catch {
      sample = "";
    }
    const detail = i === cursor ? paint(theme.muted, segment.hint) : sample;
    lines.push(`${marker} ${box} ${rowTag}  ${name} ${truncate(detail, Math.max(10, columns - labelWidth - 12))}`);
  });

  lines.push("");
  lines.push(paint(theme.muted, "preview"));
  const preview = previewLines(rows, { theme: themeName, style, icons, separator: state.separator }, columns);
  if (preview.length) lines.push(...preview.map((l) => `  ${l}`));
  else lines.push(paint(theme.muted, "  (nothing enabled)"));
  lines.push("");
  lines.push(
    paint(
      theme.muted,
      "space toggle · 1/2 row · J/K reorder · t theme · y style · i icons · r rows · s scope · enter save · q quit",
    ),
  );

  // Keep the list inside the window when the terminal is short.
  const height = (process.stdout.rows || 40) - 1;
  const shown = lines.length > height ? lines.slice(lines.length - height) : lines;
  out(CLEAR + shown.join("\n"));
}

function decode(buf) {
  const s = buf.toString("utf8");
  if (s === "\u001b[A") return "up";
  if (s === "\u001b[B") return "down";
  if (s === "\u001b[D") return "left";
  if (s === "\u001b[C") return "right";
  if (s === "\r" || s === "\n") return "enter";
  if (s === " ") return "space";
  if (s === "\t") return "tab";
  if (s === "\u0003" || s === "\u001b") return "quit";
  return s;
}

export async function runPicker({ scope = "user", cwd = process.cwd() } = {}) {
  const { config, warnings } = loadConfig(cwd);
  const state = {
    rows: (config.rows.length ? config.rows : [[], []]).map((r) => r.filter((id) => BY_ID.has(id))),
    themeName: config.theme,
    style: config.style,
    icons: config.icons,
    separator: config.separator,
    cursor: 0,
    scope,
  };
  if (state.rows.length < 2) state.rows.push([]);

  if (!process.stdin.isTTY) {
    process.stderr.write(
      "clawline: no interactive terminal. Edit the config by hand, or run `clawline --install`.\n",
    );
    return;
  }

  out(ALT_ON + HIDE_CURSOR);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const finish = (save) => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    out(SHOW_CURSOR + ALT_OFF);

    if (!save) {
      console.log("clawline: nothing saved.");
      return;
    }
    config.rows = state.rows.filter((r) => r.length);
    config.theme = state.themeName;
    config.style = state.style;
    config.icons = state.icons;
    const configPath = saveConfig(config, { scope: state.scope, cwd });
    const res = install(config, { scope: state.scope, cwd });
    const theme = getTheme(config.theme);
    console.log(paint("1", "clawline saved"));
    console.log(`  config   ${configPath}`);
    console.log(`  settings ${res.path}`);
    if (res.backup) console.log(`  backup   ${res.backup}`);
    console.log(`  command  ${commandString()}`);
    if (res.before && res.before.command !== res.after.command) {
      console.log(`  replaced ${res.before.command}`);
    }
    console.log("");
    for (const line of previewLines(config.rows, config, process.stdout.columns || 100)) {
      console.log(`  ${line}`);
    }
    console.log("");
    console.log(paint(theme.muted, "  the line appears on the next assistant message"));
    for (const w of warnings) console.log(paint(theme.warn, `  note: ${w}`));
  };

  return new Promise((resolve) => {
    const onKey = (buf) => {
      const key = decode(buf);
      const segment = SEGMENTS[state.cursor];

      switch (key) {
        case "up":
        case "k":
          state.cursor = (state.cursor - 1 + SEGMENTS.length) % SEGMENTS.length;
          break;
        case "down":
        case "j":
          state.cursor = (state.cursor + 1) % SEGMENTS.length;
          break;
        case "space":
          if (rowOf(state.rows, segment.id) >= 0) removeId(state.rows, segment.id);
          else assign(state.rows, segment.id, Math.min(state.rows.length - 1, (segment.defaultRow || 1) - 1));
          break;
        case "1":
          assign(state.rows, segment.id, 0);
          break;
        case "2":
          assign(state.rows, segment.id, 1);
          break;
        case "tab":
          if (rowOf(state.rows, segment.id) >= 0) {
            const r = rowOf(state.rows, segment.id);
            assign(state.rows, segment.id, (r + 1) % Math.max(2, state.rows.length));
          }
          break;
        case "K":
          move(state.rows, segment.id, -1);
          break;
        case "J":
          move(state.rows, segment.id, 1);
          break;
        case "t": {
          const i = THEME_NAMES.indexOf(state.themeName);
          state.themeName = THEME_NAMES[(i + 1) % THEME_NAMES.length];
          break;
        }
        case "y":
          state.style = STYLE_NAMES[(STYLE_NAMES.indexOf(state.style) + 1) % STYLE_NAMES.length];
          break;
        case "i":
          state.icons = state.icons === "nerd" ? "none" : "nerd";
          break;
        case "r":
          if (state.rows.length > 1 && !state.rows[1].length) state.rows = [state.rows[0]];
          else if (state.rows.length === 1) state.rows.push([]);
          break;
        case "s":
          state.scope = state.scope === "user" ? "project" : "user";
          break;
        case "enter":
          process.stdin.off("data", onKey);
          finish(true);
          resolve();
          return;
        case "q":
        case "quit":
          process.stdin.off("data", onKey);
          finish(false);
          resolve();
          return;
        default:
          break;
      }
      draw(state);
    };

    draw(state);
    process.stdin.on("data", onKey);
  });
}

export { previewLines };
