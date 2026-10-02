// Tips, custom commands, fixed text.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { paint, truncate } from "../ansi.mjs";
import { contextUsage } from "./usage.mjs";
import { gitState } from "../git.mjs";
import { permissionMode } from "../transcript.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TIPS_FILE = join(HERE, "..", "..", "data", "tips.json");

let bundled = null;
function loadBundled() {
  if (bundled) return bundled;
  try {
    bundled = JSON.parse(readFileSync(TIPS_FILE, "utf8"));
  } catch {
    bundled = { rules: [], tips: [] };
  }
  return bundled;
}

function loadUserTips(file) {
  if (!file) return [];
  const path = file.startsWith("~") ? join(homedir(), file.slice(1)) : file;
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

// Facts the rules match against, gathered once per render.
function facts(data, cwd) {
  const { pct, size, used } = contextUsage(data);
  const g = gitState(cwd);
  const c = data.prompt_cache || {};
  return {
    ctxPct: pct === null ? null : Math.round(pct),
    ctxLeft: used === null ? null : Math.max(0, size - used),
    exceeds200k: !!data.exceeds_200k_tokens,
    cacheCold: !!c.caching_observed && c.warm === false,
    cacheHit: typeof c.hit_ratio === "number" ? Math.round(c.hit_ratio * 100) : null,
    rate5h: data.rate_limits?.five_hour?.used_percentage ?? null,
    rateWeek: data.rate_limits?.seven_day?.used_percentage ?? null,
    dirty: g.staged + g.unstaged,
    conflicts: g.conflicts,
    ahead: g.ahead,
    mode: permissionMode(data.transcript_path),
    cost: data.cost?.total_cost_usd ?? null,
    prChanges: data.pr?.review_state === "changes_requested",
  };
}

const CONDITIONS = {
  contextPctAtLeast: (f, v) => f.ctxPct !== null && f.ctxPct >= v,
  contextPctBelow: (f, v) => f.ctxPct !== null && f.ctxPct < v,
  exceeds200k: (f, v) => f.exceeds200k === v,
  cacheCold: (f, v) => f.cacheCold === v,
  cacheHitBelow: (f, v) => f.cacheHit !== null && f.cacheHit < v,
  rate5hAtLeast: (f, v) => f.rate5h !== null && f.rate5h >= v,
  rateWeekAtLeast: (f, v) => f.rateWeek !== null && f.rateWeek >= v,
  gitDirtyAtLeast: (f, v) => f.dirty >= v,
  gitConflicts: (f, v) => (f.conflicts > 0) === v,
  gitAheadAtLeast: (f, v) => f.ahead >= v,
  modeIs: (f, v) => f.mode === v,
  costAtLeast: (f, v) => f.cost !== null && f.cost >= v,
  prChangesRequested: (f, v) => f.prChanges === v,
};

function matches(rule, f) {
  return Object.entries(rule.when || {}).every(([k, v]) => {
    const test = CONDITIONS[k];
    return test ? test(f, v) : false;
  });
}

function fill(text, f) {
  return text.replace(/\{(\w+)\}/g, (_, key) => {
    const v = f[key];
    if (v === null || v === undefined) return "";
    if (key === "cost") return `$${Number(v).toFixed(2)}`;
    if (typeof v === "number") return String(Math.round(v));
    return String(v);
  });
}

// Stable index so the tip holds still within one prompt instead of flickering per message.
// On "time" rotation it changes once per `seconds`, which only shows up as fast as Claude Code
// re-runs the status line (its refreshInterval).
function rotateIndex(data, rotate, count, seconds = 30) {
  if (!count) return 0;
  if (rotate === "time") return Math.floor(Date.now() / (Math.max(1, seconds) * 1000)) % count;
  const seed = data.prompt_id || data.session_id || "clawline";
  const hash = createHash("sha1").update(String(seed)).digest();
  return hash.readUInt32BE(0) % count;
}

export const tips = {
  id: "tips",
  label: "tips",
  hint: "state-aware nudges, else a rotating Claude Code tip",
  defaultRow: 2,
  options: {
    contextAware: true,
    rotate: "prompt",
    rotateSeconds: 30,
    file: null,
    maxWidth: 52,
    prefix: "tip",
  },
  sample: (t) => paint(t.muted, "tip ") + paint(t.tip, "esc esc rewinds the conversation"),
  render({ data, cfg, theme, cwd }) {
    const db = loadBundled();
    const f = facts(data, cwd);

    if (cfg.contextAware) {
      for (const rule of db.rules) {
        if (matches(rule, f)) {
          const body = fill(rule.text, f);
          return (
            paint(theme.muted, `${cfg.prefix} `) +
            truncate(paint(theme[rule.role] || theme.tip, body), cfg.maxWidth)
          );
        }
      }
    }

    const pool = [...loadUserTips(cfg.file), ...db.tips];
    if (!pool.length) return "";
    const tip = pool[rotateIndex(data, cfg.rotate, pool.length, cfg.rotateSeconds)];
    return paint(theme.muted, `${cfg.prefix} `) + truncate(paint(theme.tip, tip), cfg.maxWidth);
  },
};

const customCache = (key) =>
  join(tmpdir(), `clawline-custom-${createHash("sha1").update(key).digest("hex").slice(0, 12)}.json`);

export const custom = {
  id: "custom",
  label: "custom",
  hint: "first line of any shell command you configure",
  defaultRow: null,
  options: { command: null, ttl: 30, label: "", maxWidth: 40 },
  sample: (t) => paint(t.muted, "node v20.20.0"),
  // Runs through a shell on purpose: the command comes from the user's own config file and
  // pipes/globs are the point. Nothing from the session payload is interpolated into it.
  render({ cfg, theme, cwd }) {
    if (!cfg.command) return "";
    const file = customCache(`${cfg.command}|${cwd}`);
    let out = "";
    try {
      const c = JSON.parse(readFileSync(file, "utf8"));
      if (Date.now() - c.at < (cfg.ttl || 30) * 1000) out = c.value;
    } catch {}
    if (!out) {
      try {
        out = String(
          execSync(cfg.command, { cwd, encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }),
        )
          .split("\n")[0]
          .trim();
      } catch {
        out = "";
      }
      try {
        writeFileSync(file, JSON.stringify({ at: Date.now(), value: out }));
      } catch {}
    }
    if (!out) return "";
    const body = truncate(out, cfg.maxWidth);
    return cfg.label ? paint(theme.muted, `${cfg.label} `) + body : body;
  },
};

export const text = {
  id: "text",
  label: "text",
  hint: "fixed label of your own, handy as a separator or machine name",
  defaultRow: null,
  options: { value: "", role: "muted" },
  sample: (t) => paint(t.muted, "laptop"),
  render({ cfg, theme }) {
    if (!cfg.value) return "";
    return paint(theme[cfg.role] || theme.muted, cfg.value);
  },
};
