// Context window, token counts, rate limits, cost, time, cache.

import { paint, bar, humanTokens, humanDuration, humanMoney, untilEpoch } from "../ansi.mjs";
import { loadColor } from "../theme.mjs";
import { rates } from "../state.mjs";

// Context percentage is input-only, matching how Claude Code computes used_percentage.
export function contextUsage(data) {
  const w = data.context_window || {};
  const size = w.context_window_size || 200_000;
  const u = w.current_usage || null;
  const fromUsage = u
    ? (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
    : null;
  const used = w.total_input_tokens ?? fromUsage ?? null;
  const pct =
    typeof w.used_percentage === "number"
      ? w.used_percentage
      : used !== null && size
        ? (used / size) * 100
        : null;
  return { size, used, pct };
}

export const context = {
  id: "context",
  label: "context",
  hint: "context bar, percent used, exact tokens out of total",
  icon: "\u{F035B}",
  priority: 9,
  defaultRow: 2,
  options: {
    bar: true,
    width: 10,
    glyphs: "blocks",
    showPercent: true,
    showTokens: true,
    warnAt: 75,
    label: "",
  },
  sample: (t) =>
    bar(38, { width: 10, color: loadColor(t, 38) }) +
    " " +
    paint(loadColor(t, 38), "38%") +
    paint(t.muted, " 77k/200k"),
  render({ data, cfg, theme }) {
    const { size, used, pct } = contextUsage(data);
    if (pct === null) {
      const lead = cfg.label ? paint(theme.muted, `${cfg.label} `) : "";
      return cfg.bar
        ? lead +
            bar(0, { width: cfg.width, glyphs: cfg.glyphs, color: theme.muted, track: theme.track }) +
            paint(theme.muted, " —")
        : paint(theme.muted, `${cfg.label || "ctx"} —`);
    }
    const color = loadColor(theme, pct);
    const parts = [];
    if (cfg.label) parts.push(paint(theme.muted, cfg.label));
    if (cfg.bar) parts.push(bar(pct, { width: cfg.width, glyphs: cfg.glyphs, color, track: theme.track }));
    if (cfg.showPercent) parts.push(paint(color, `${Math.round(pct)}%`));
    if (cfg.showTokens) {
      parts.push(paint(theme.muted, `${humanTokens(used)}/${humanTokens(size)}`));
    }
    if (pct >= cfg.warnAt) parts.push(paint(color, "!"));
    return parts.join(" ");
  },
};

export const tokens = {
  id: "tokens",
  label: "tokens",
  hint: "exact token counts: in/out/cached, or used out of the window",
  icon: "\u{F0EC}",
  priority: 4,
  defaultRow: null,
  options: { showCache: true, style: "usage" },
  sample: (t) => paint(t.muted, "in ") + "8.5k" + paint(t.muted, " out ") + "1.2k",
  render({ data, cfg, theme }) {
    // "window" is the pair that belongs next to a context bar: used out of the window size.
    if (cfg.style === "window") {
      const { size, used } = contextUsage(data);
      if (used === null) return "";
      return paint(theme.muted, `${humanTokens(used)}/${humanTokens(size)}`);
    }
    const u = data.context_window?.current_usage;
    if (!u) return "";
    const parts = [
      paint(theme.muted, "in ") + humanTokens(u.input_tokens),
      paint(theme.muted, "out ") + humanTokens(u.output_tokens),
    ];
    if (cfg.showCache) {
      const cached = (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (cached) parts.push(paint(theme.muted, "cached ") + humanTokens(cached));
    }
    return parts.join(paint(theme.muted, " · "));
  },
};

function rateSegment({ id, label, hint, window: key, prefix, defaultRow, icon, priority }) {
  return {
    id,
    label,
    hint,
    icon,
    priority,
    shrinks: 8, // "wk 91%" leads, so a cut keeps the number
    defaultRow,
    options: { showReset: true, bar: false, width: 10, glyphs: "blocks" },
    sample: (t) => paint(t.muted, `${prefix} `) + paint(loadColor(t, 24), "24%") + paint(t.muted, " 2h11m"),
    render({ data, cfg, theme }) {
      const w = data.rate_limits?.[key];
      if (!w || typeof w.used_percentage !== "number") return "";
      const pct = Math.round(w.used_percentage);
      const color = loadColor(theme, pct);
      let out = paint(theme.muted, `${prefix} `);
      if (cfg.bar) out += `${bar(pct, { width: cfg.width, glyphs: cfg.glyphs, color, track: theme.track })} `;
      out += paint(color, `${pct}%`);
      if (cfg.showReset) {
        const left = untilEpoch(w.resets_at);
        if (left) out += paint(theme.muted, ` ${left}`);
      }
      return out;
    },
  };
}

export const rate5h = rateSegment({
  id: "rate-5h",
  label: "rate-5h",
  hint: "5-hour rate limit used, and time to reset",
  window: "five_hour",
  prefix: "5h",
  icon: "\u{F051F}",
  priority: 8,
  defaultRow: 2,
});

export const rateWeek = {
  ...rateSegment({
    id: "rate-week",
    label: "rate-week",
    hint: "7-day rate limit used, and spend limit when one applies",
    window: "seven_day",
    prefix: "wk",
    defaultRow: 2,
    icon: "\u{F00ED}",
    priority: 7,
  }),
  options: { showReset: true, includeSpendLimit: true, bar: false, width: 10, glyphs: "blocks" },
  render({ data, cfg, theme }) {
    const parts = [];
    const w = data.rate_limits?.seven_day;
    if (w && typeof w.used_percentage === "number") {
      const pct = Math.round(w.used_percentage);
      const color = loadColor(theme, pct);
      let out = paint(theme.muted, "wk ");
      if (cfg.bar) out += `${bar(pct, { width: cfg.width, glyphs: cfg.glyphs, color, track: theme.track })} `;
      out += paint(color, `${pct}%`);
      if (cfg.showReset) {
        const left = untilEpoch(w.resets_at);
        if (left) out += paint(theme.muted, ` ${left}`);
      }
      parts.push(out);
    }
    const spend = data.rate_limits?.spend_limit;
    if (cfg.includeSpendLimit && spend && typeof spend.used_percentage === "number") {
      const pct = Math.round(spend.used_percentage);
      parts.push(paint(theme.muted, "spend ") + paint(loadColor(theme, pct), `${pct}%`));
    }
    return parts.join(paint(theme.muted, " · "));
  },
};

export const cost = {
  id: "cost",
  label: "cost",
  hint: "estimated session cost in USD",
  icon: "\u{F155}",
  priority: 6,
  defaultRow: 2,
  options: {},
  sample: (t) => paint(t.cost, "$1.23"),
  render({ data, theme }) {
    const usd = data.cost?.total_cost_usd;
    if (typeof usd !== "number") return "";
    return paint(theme.cost, humanMoney(usd));
  },
};

export const duration = {
  id: "duration",
  label: "duration",
  hint: "session wall-clock time, optionally the share spent waiting on the API",
  icon: "\u{F017}",
  priority: 2,
  defaultRow: null,
  options: { showApiShare: false },
  sample: (t) => paint(t.muted, "1h03m"),
  render({ data, cfg, theme }) {
    const ms = data.cost?.total_duration_ms;
    if (!ms) return "";
    let out = paint(theme.muted, humanDuration(ms));
    if (cfg.showApiShare && data.cost?.total_api_duration_ms) {
      const share = Math.round((data.cost.total_api_duration_ms / ms) * 100);
      out += paint(theme.muted, ` (${share}% api)`);
    }
    return out;
  },
};

export const burn = {
  id: "burn",
  label: "burn",
  hint: "how fast context is filling, and spend per hour",
  icon: "\u{F0238}",
  priority: 3,
  defaultRow: null,
  options: { showTokens: true, showSpend: true },
  sample: (t) => paint(t.warn, "+12k/min") + paint(t.muted, " $0.9/h"),
  render({ data, cfg, theme }) {
    const { used } = contextUsage(data);
    const r = rates(data.session_id, {
      tokens: used || 0,
      costUsd: data.cost?.total_cost_usd || 0,
      durationMs: data.cost?.total_duration_ms || 0,
    });
    const parts = [];
    if (cfg.showTokens && typeof r.tokensPerMin === "number" && r.tokensPerMin !== 0) {
      const sign = r.tokensPerMin > 0 ? "+" : "-";
      parts.push(paint(theme.warn, `${sign}${humanTokens(Math.abs(r.tokensPerMin))}/min`));
    }
    if (cfg.showSpend && typeof r.dollarsPerHour === "number") {
      parts.push(paint(theme.muted, `${humanMoney(r.dollarsPerHour)}/h`));
    }
    return parts.join(" ");
  },
};

export const cache = {
  id: "cache",
  label: "cache",
  hint: "prompt cache warm or cold, and hit ratio",
  icon: "\u{F01BC}",
  priority: 4,
  defaultRow: null,
  options: { showCause: false },
  sample: (t) => paint(t.muted, "cache ") + paint(t.good, "91%"),
  render({ data, cfg, theme }) {
    const c = data.prompt_cache;
    if (!c || !c.caching_observed) return "";
    if (!c.warm) {
      let out = paint(theme.muted, "cache ") + paint(theme.warn, "cold");
      if (cfg.showCause && c.last_miss_cause?.causes?.length) {
        out += paint(theme.muted, ` ${c.last_miss_cause.causes[0]}`);
      }
      return out;
    }
    if (typeof c.hit_ratio !== "number") return paint(theme.muted, "cache ") + paint(theme.good, "warm");
    const pct = Math.round(c.hit_ratio * 100);
    const role = pct >= 80 ? theme.good : pct >= 50 ? theme.warn : theme.bad;
    let out = paint(theme.muted, "cache ") + paint(role, `${pct}%`);
    if (cfg.showCause && c.misses) out += paint(theme.muted, ` ${c.misses} miss`);
    return out;
  },
};
