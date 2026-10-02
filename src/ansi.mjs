// ANSI helpers. Everything a segment needs to colour, measure and trim text.

const BEL = "\u0007";
const ESC = "\u001b";
const ANSI_RE = /\u001b\[[0-9;]*m/g;
const OSC8_RE = /\u001b\]8;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const SEQ_RE = /^\u001b\[[0-9;]*m|^\u001b\]8;[^\u0007\u001b]*(?:\u0007|\u001b\\)/;

// Colour is off when NO_COLOR is set.
export const colorEnabled = () => !process.env.NO_COLOR;

export function paint(code, text) {
  if (!code || !colorEnabled()) return String(text);
  return `${ESC}[${code}m${text}${ESC}[0m`;
}

export function osc8(url, text) {
  if (!url) return text;
  return `${ESC}]8;;${url}${BEL}${text}${ESC}]8;;${BEL}`;
}

export function strip(s) {
  return String(s).replace(OSC8_RE, "").replace(ANSI_RE, "");
}

// Rough terminal cell count: most code points are one cell, CJK and emoji are two.
const WIDE = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
];

const cellsFor = (cp) => (WIDE.some(([a, b]) => cp >= a && cp <= b) ? 2 : 1);

export function width(s) {
  let n = 0;
  for (const ch of strip(s)) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0f || (cp >= 0x300 && cp <= 0x36f)) continue; // variation / combining
    n += cellsFor(cp);
  }
  return n;
}

// Cut to `max` cells, keeping escape sequences intact and closing with a reset.
export function truncate(s, max) {
  if (max <= 0) return "";
  if (width(s) <= max) return s;
  const str = String(s);
  let out = "";
  let cells = 0;
  let i = 0;
  const budget = max - 1; // room for the ellipsis
  while (i < str.length) {
    if (str[i] === ESC) {
      const m = SEQ_RE.exec(str.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    const ch = String.fromCodePoint(str.codePointAt(i));
    const w = cellsFor(ch.codePointAt(0));
    if (cells + w > budget) break;
    out += ch;
    cells += w;
    i += ch.length;
  }
  return colorEnabled() ? `${out}…${ESC}[0m` : `${out}…`;
}

export const GLYPHS = {
  blocks: { full: "█", empty: "░" },
  bars: { full: "▬", empty: "─" },
  dots: { full: "●", empty: "○" },
  ascii: { full: "#", empty: "." },
  smooth: { full: "█", empty: "░", partial: " ▏▎▍▌▋▊▉" },
};

export function bar(pct, { width = 10, glyphs = "blocks", color = "", track = "" } = {}) {
  // A width from a hand-edited config can be anything; a bar is 1 to 200 cells.
  const w = Math.max(1, Math.min(200, Math.round(Number(width)) || 10));
  const g = GLYPHS[glyphs] || GLYPHS.blocks;
  const safe = Math.max(0, Math.min(100, Number(pct) || 0));
  if (g.partial) {
    // Eighth blocks over a track colour: 38% of ten cells is three full cells and a sliver.
    const eighths = Math.round((safe / 100) * w * 8);
    const full = Math.floor(eighths / 8);
    const sliver = eighths % 8;
    const rest = w - full - (sliver ? 1 : 0);
    let out = full ? paint(color, g.full.repeat(full)) : "";
    if (sliver) out += paint([color, track].filter(Boolean).join(";"), g.partial[sliver]);
    // Without a track colour the empty cells would be invisible, so they fall back to a shade.
    if (rest > 0) out += track && colorEnabled() ? paint(track, " ".repeat(rest)) : paint("90", g.empty.repeat(rest));
    return out;
  }
  const filled = Math.max(0, Math.min(w, Math.round((safe / 100) * w)));
  const head = filled ? paint(color, g.full.repeat(filled)) : "";
  const tail = w - filled > 0 ? paint("90", g.empty.repeat(w - filled)) : "";
  return head + tail;
}

// ---------------------------------------------------------------- formatting

export function humanTokens(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 10_000) return `${(v / 1000).toFixed(1)}k`;
  if (v < 1_000_000) return `${Math.round(v / 1000)}k`;
  return `${(v / 1_000_000).toFixed(1)}M`;
}

export function humanDuration(ms) {
  const total = Math.floor((Number(ms) || 0) / 1000);
  if (total <= 0) return "0s";
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d) return h ? `${d}d${h}h` : `${d}d`;
  if (h) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export function humanMoney(usd) {
  const v = Number(usd) || 0;
  if (v >= 100) return `$${Math.round(v)}`;
  if (v >= 10) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}

// Time left until a Unix-epoch-seconds deadline; "" once it has passed. Deadlines further out
// than a month are treated as garbage data rather than printed as "95012d".
export function untilEpoch(epochSeconds, maxDays = 31) {
  if (!epochSeconds) return "";
  const ms = Number(epochSeconds) * 1000 - Date.now();
  if (ms <= 0 || ms > maxDays * 86_400_000) return "";
  return humanDuration(ms);
}
