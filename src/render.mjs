// The hot path: session JSON in, status line rows out. A broken segment must never take
// the whole line down, so every render is guarded.

import { readFileSync } from "node:fs";
import { paint } from "./ansi.mjs";
import { getTheme } from "./theme.mjs";
import { BY_ID } from "./segments/index.mjs";
import { segmentOptions } from "./config.mjs";
import { layout, FILL } from "./style.mjs";

const LEAD = /^\u001b\[([0-9;]*)m/;

// The icon takes whatever colour the segment opens with, so it matches without a colour table.
export function withIcon(id, text, config) {
  const icon = config?.icons === "nerd" && BY_ID.get(id)?.icon;
  return icon ? `${paint(LEAD.exec(text)?.[1] || "", icon)} ${text}` : text;
}

export function renderSegment(id, { data, config, theme, cwd, columns }) {
  const segment = BY_ID.get(id);
  if (!segment) return "";
  try {
    const out = segment.render({
      data,
      cfg: segmentOptions(config, id),
      theme,
      cwd,
      columns,
      config,
    });
    return typeof out === "string" ? out : "";
  } catch {
    return "";
  }
}

// Fit plain parts into the terminal: shorten the last one first, drop it only if that is not
// enough. Rows go through `layout`, which does the same by priority instead of position.
export function fitRow(parts, separator, columns) {
  const items = parts.map((text, i) => ({ id: `part${i}`, text, priority: -i, shrinks: 8 }));
  return layout(items, { style: "plain", theme: { sep: "" }, config: { separator }, columns });
}

export function render(data, { config, columns = Number(process.env.COLUMNS) || 120 } = {}) {
  const theme = getTheme(config.theme);
  const cwd = data.workspace?.current_dir || data.cwd || process.cwd();
  const budget = Math.max(20, columns - 2 - (config.padding || 0) * 2);

  const rows = [];
  for (const row of config.rows || []) {
    const items = row
      .map((id) => {
        if (id === FILL) return { id };
        const text = renderSegment(id, { data, config, theme, cwd, columns: budget });
        if (!text) return null;
        const { priority, shrinks } = BY_ID.get(id);
        return { id, text: withIcon(id, text, config), priority, shrinks };
      })
      .filter(Boolean);
    if (!items.some((i) => i.id !== FILL)) continue;
    const line = layout(items, { style: config.style, theme, config, columns: budget });
    if (line.trim()) rows.push(line);
  }
  return rows;
}

export function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}
