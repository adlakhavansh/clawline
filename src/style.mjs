// How segments sit together in a row. Segments hand back painted strings; a style decides the
// joins: plain gaps, thin rules, powerline arrows or rounded pills. A `fill` in a row pushes
// everything after it to the right edge.

import { paint, width, truncate, strip } from "./ansi.mjs";

export const STYLE_NAMES = ["plain", "minimal", "powerline", "capsule"];
export const ICON_SETS = ["none", "nerd"];
export const FILL = "fill";

const ARROW_RIGHT = "\u{E0B0}";
const ARROW_LEFT = "\u{E0B2}";
const CAP_LEFT = "\u{E0B6}";
const CAP_RIGHT = "\u{E0B4}";
const RESET = "\u001b[0m";

// "48;5;236" -> "38;5;236", "44" -> "34", "104" -> "94". An arrow or a cap is drawn in the
// colour of the block it belongs to.
export function bgToFg(code) {
  if (!code) return "";
  if (code.startsWith("48;")) return `38;${code.slice(3)}`;
  const n = Number(code);
  return (n >= 40 && n <= 47) || (n >= 100 && n <= 107) ? String(n - 10) : "";
}

const sgr = (...codes) => codes.filter(Boolean).join(";");

// Segments end every colour with a full reset, which would also wipe the block behind them.
// Inside a block each reset puts the block's background straight back.
const onBlock = (text, bg) => (bg ? text.replaceAll(RESET, `\u001b[0;${bg}m`) : text);

// The model block gets the accent, with its text in ink; the rest alternate base and alt.
function blocks(items, theme, alternate) {
  let n = 0;
  return items.map((item) => {
    if (item.id === "model" && theme.bg?.accent) {
      return { bg: theme.bg.accent, body: onBlock(paint(theme.ink, strip(item.text)), theme.bg.accent) };
    }
    const bg = (alternate && n++ % 2 ? theme.bg?.alt : theme.bg?.base) || "";
    return { bg, body: onBlock(item.text, bg) };
  });
}

const STYLES = {
  plain: {
    join: (items, { theme, config }) =>
      items.map((i) => i.text).join(paint(theme.sep, config.separator ?? "  ")),
  },
  minimal: {
    join: (items, { theme, config }) => {
      const gap = config.separator ?? "  ";
      return items.map((i) => i.text).join(paint(theme.sep, `${gap}│${gap}`));
    },
  },
  powerline: {
    join(items, { theme }, side) {
      const b = blocks(items, theme, true);
      return b
        .map(({ bg, body }, i) => {
          const block = paint(bg, ` ${body} `);
          if (side === "right") return paint(sgr(bgToFg(bg), b[i - 1]?.bg), ARROW_LEFT) + block;
          return block + paint(sgr(bgToFg(bg), b[i + 1]?.bg), ARROW_RIGHT);
        })
        .join("");
    },
  },
  capsule: {
    join: (items, { theme }) =>
      blocks(items, theme, false)
        .map(({ bg, body }) => paint(bgToFg(bg), CAP_LEFT) + paint(bg, body) + paint(bgToFg(bg), CAP_RIGHT))
        .join(" "),
  },
};

// Lay out one row in `columns` cells. When it does not fit, the least important segment gives
// way first. A segment whose front carries the meaning (`bypass…`, a tip, a path) is shortened
// while at least `shrinks` cells of it survive; a number-carrying one is dropped whole, because
// `cache …` says nothing. Equal priority goes right to left.
export function layout(items, { style, theme, config = {}, columns }) {
  const look = STYLES[style] || STYLES.plain;
  const at = items.findIndex((i) => i.id === FILL);
  const left = (at < 0 ? items : items.slice(0, at)).filter((i) => i.id !== FILL);
  const right = at < 0 ? [] : items.slice(at + 1).filter((i) => i.id !== FILL);
  const ctx = { theme, config };

  const draw = () => {
    const l = left.length ? look.join(left, ctx, "left") : "";
    const r = right.length ? look.join(right, ctx, "right") : "";
    if (!r) return l;
    return l + " ".repeat(Math.max(2, columns - width(l) - width(r))) + r;
  };

  for (;;) {
    const line = draw();
    const over = width(line) - columns;
    const all = [...left, ...right];
    if (over <= 0 || !all.length) return line;
    const victim = all.reduce((a, b) => ((b.priority ?? 5) <= (a.priority ?? 5) ? b : a));
    const room = width(victim.text) - over;
    if (all.length === 1) {
      victim.text = truncate(victim.text, room);
      return draw();
    }
    if (victim.shrinks && room >= victim.shrinks) {
      victim.text = truncate(victim.text, room);
      continue;
    }
    const side = left.includes(victim) ? left : right;
    side.splice(side.indexOf(victim), 1);
  }
}
