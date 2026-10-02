// The hot path: session JSON in, status line rows out. A broken segment must never take
// the whole line down, so every render is guarded.

import { readFileSync } from "node:fs";
import { paint, width, truncate } from "./ansi.mjs";
import { getTheme } from "./theme.mjs";
import { BY_ID } from "./segments/index.mjs";
import { segmentOptions } from "./config.mjs";

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

// Fit a row into the terminal: shorten the last segment first, drop segments only if that
// is not enough.
export function fitRow(parts, separator, columns) {
  const sepWidth = width(separator);
  let kept = [...parts];
  while (kept.length) {
    const total = kept.reduce((n, p) => n + width(p), 0) + sepWidth * (kept.length - 1);
    if (total <= columns) return kept.join(separator);
    if (kept.length === 1) return truncate(kept[0], columns);
    const others = kept.slice(0, -1);
    const othersWidth = others.reduce((n, p) => n + width(p), 0) + sepWidth * others.length;
    const room = columns - othersWidth;
    if (room >= 8) return [...others, truncate(kept[kept.length - 1], room)].join(separator);
    kept = others;
  }
  return "";
}

export function render(data, { config, columns = Number(process.env.COLUMNS) || 120 } = {}) {
  const theme = getTheme(config.theme);
  const cwd = data.workspace?.current_dir || data.cwd || process.cwd();
  const separator = paint(theme.sep, config.separator || "  ");
  const budget = Math.max(20, columns - 2 - (config.padding || 0) * 2);

  const rows = [];
  for (const row of config.rows || []) {
    const parts = row
      .map((id) => renderSegment(id, { data, config, theme, cwd, columns: budget }))
      .filter((p) => p && p.length);
    if (!parts.length) continue;
    const line = fitRow(parts, separator, budget);
    if (line) rows.push(line);
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
