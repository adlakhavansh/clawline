// Non-interactive config edits, for when there is no TTY to run the picker in — inside
// Claude Code, over SSH, or from a script.

import { BY_ID, SEGMENTS } from "./segments/index.mjs";
import { THEME_NAMES } from "./theme.mjs";
import { STYLE_NAMES, ICON_SETS } from "./style.mjs";

export function parseValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

function ensureRows(config, count = 2) {
  if (!Array.isArray(config.rows)) config.rows = [[], []];
  while (config.rows.length < count) config.rows.push([]);
  return config.rows;
}

const rowOf = (rows, id) => rows.findIndex((row) => row.includes(id));

function removeId(rows, id) {
  for (const row of rows) {
    const i = row.indexOf(id);
    if (i >= 0) row.splice(i, 1);
  }
}

// Each edit returns a line describing what changed, or throws with a usable message.
export function applyEdit(config, edit) {
  const rows = ensureRows(config);

  if (edit.kind === "toggle" || edit.kind === "on" || edit.kind === "off") {
    const id = edit.id;
    if (!BY_ID.has(id)) throw new Error(`unknown segment "${id}" (clawline --list shows them all)`);
    const at = rowOf(rows, id);
    const wantOn = edit.kind === "on" || (edit.kind === "toggle" && at < 0);
    if (!wantOn) {
      if (at < 0) return `${id} was already off`;
      removeId(rows, id);
      return `${id} off`;
    }
    if (at >= 0) return `${id} was already on (row ${at + 1})`;
    // Segments with no default row land on the last row, which is where the data lives.
    const preferred = BY_ID.get(id).defaultRow;
    const target = preferred ? Math.min(rows.length - 1, preferred - 1) : rows.length - 1;
    rows[target].push(id);
    return `${id} on (row ${target + 1})`;
  }

  if (edit.kind === "row") {
    const id = edit.id;
    if (!BY_ID.has(id)) throw new Error(`unknown segment "${id}"`);
    const index = Number(edit.row) - 1;
    if (!Number.isInteger(index) || index < 0 || index > 3) throw new Error("row must be 1 to 4");
    ensureRows(config, index + 1);
    removeId(config.rows, id);
    config.rows[index].push(id);
    return `${id} moved to row ${index + 1}`;
  }

  if (edit.kind === "theme") {
    if (!THEME_NAMES.includes(edit.theme)) {
      throw new Error(`unknown theme "${edit.theme}" (${THEME_NAMES.join(", ")})`);
    }
    config.theme = edit.theme;
    return `theme ${edit.theme}`;
  }

  if (edit.kind === "style") {
    if (!STYLE_NAMES.includes(edit.style)) {
      throw new Error(`unknown style "${edit.style}" (${STYLE_NAMES.join(", ")})`);
    }
    config.style = edit.style;
    return `style ${edit.style}`;
  }

  if (edit.kind === "icons") {
    if (!ICON_SETS.includes(edit.icons)) throw new Error(`icons is ${ICON_SETS.join(" or ")}`);
    config.icons = edit.icons;
    return `icons ${edit.icons}`;
  }

  if (edit.kind === "set") {
    const { id, option, value } = edit;
    if (!BY_ID.has(id)) throw new Error(`unknown segment "${id}"`);
    const known = BY_ID.get(id).options || {};
    if (!(option in known)) {
      throw new Error(`${id} has no option "${option}" (${Object.keys(known).join(", ") || "none"})`);
    }
    config.segments[id] = { ...(config.segments[id] || {}), [option]: value };
    return `${id}.${option} = ${JSON.stringify(value)}`;
  }

  throw new Error(`unsupported edit "${edit.kind}"`);
}

// `--toggle git --set context.width=16 --theme nord --row tips 1`
export function parseEdits(argv) {
  const edits = [];
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--toggle" || flag === "--on" || flag === "--off") {
      const id = argv[i + 1];
      if (!id || id.startsWith("--")) throw new Error(`${flag} needs a segment id`);
      edits.push({ kind: flag.slice(2), id });
      i += 1;
    } else if (flag === "--row") {
      const id = argv[i + 1];
      const row = argv[i + 2];
      if (!id || !row) throw new Error("--row needs a segment id and a row number");
      edits.push({ kind: "row", id, row });
      i += 2;
    } else if (flag === "--theme" || flag === "--style" || flag === "--icons") {
      const kind = flag.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${flag} needs a name`);
      edits.push({ kind, [kind]: value });
      i += 1;
    } else if (flag === "--set") {
      const spec = argv[i + 1] || "";
      const m = /^([a-z0-9-]+)\.([A-Za-z0-9_]+)=(.*)$/.exec(spec);
      if (!m) throw new Error('--set wants segment.option=value, e.g. --set context.width=16');
      edits.push({ kind: "set", id: m[1], option: m[2], value: parseValue(m[3]) });
      i += 1;
    }
  }
  return edits;
}

export const hasEditFlags = (argv) =>
  argv.some((a) => ["--toggle", "--on", "--off", "--row", "--theme", "--style", "--icons", "--set"].includes(a));

export function describeOptions(id) {
  const segment = BY_ID.get(id);
  if (!segment) return "";
  const opts = Object.entries(segment.options || {});
  if (!opts.length) return `${id}: no options`;
  return `${id}: ${opts.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")}`;
}

export const allOptionLines = () => SEGMENTS.map((s) => describeOptions(s.id));
