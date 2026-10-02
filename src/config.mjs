// Config loading: defaults, then ~/.claude/clawline.json, then ./.clawline.json.
// `rows` doubles as the enable list — a segment that is not in a row is off.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { SEGMENTS, BY_ID, defaultRows } from "./segments/index.mjs";
import { THEMES } from "./theme.mjs";

export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
export const userConfigPath = () => join(claudeDir(), "clawline.json");
export const projectConfigPath = (cwd) => join(cwd || process.cwd(), ".clawline.json");

export function defaults() {
  const segments = {};
  for (const s of SEGMENTS) segments[s.id] = { ...(s.options || {}) };
  return {
    theme: "dark",
    separator: "  ",
    padding: 0,
    rows: defaultRows(),
    segments,
  };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    return { __error: String(err.message || err) };
  }
}

function mergeInto(base, patch, warnings, label) {
  if (!patch || typeof patch !== "object") return base;
  if (patch.__error) {
    warnings.push(`${label}: ${patch.__error}`);
    return base;
  }
  if (typeof patch.theme === "string") base.theme = patch.theme;
  if (typeof patch.separator === "string") base.separator = patch.separator;
  if (Number.isFinite(patch.padding)) base.padding = patch.padding;
  if (Array.isArray(patch.rows)) {
    base.rows = patch.rows.filter(Array.isArray).map((row) => row.filter((id) => typeof id === "string"));
  }
  if (patch.segments && typeof patch.segments === "object") {
    for (const [id, opts] of Object.entries(patch.segments)) {
      if (!opts || typeof opts !== "object") continue;
      base.segments[id] = { ...(base.segments[id] || {}), ...opts };
    }
  }
  return base;
}

export function validate(config) {
  const warnings = [];
  if (!THEMES[config.theme]) {
    warnings.push(`unknown theme "${config.theme}", falling back to dark`);
    config.theme = "dark";
  }
  if (!config.rows.length) warnings.push("no rows configured, the status line will be empty");
  for (const row of config.rows) {
    for (const id of row) {
      if (!BY_ID.has(id)) warnings.push(`unknown segment "${id}" (ignored)`);
    }
  }
  for (const id of Object.keys(config.segments)) {
    if (!BY_ID.has(id)) warnings.push(`options for unknown segment "${id}" (ignored)`);
  }
  // Negative padding would make the line wider than the terminal.
  if (!(config.padding >= 0)) {
    warnings.push(`padding ${config.padding} is below 0, using 0`);
    config.padding = 0;
  }
  return warnings;
}

export function loadConfig(cwd = process.cwd()) {
  const config = defaults();
  const warnings = [];
  const sources = [];

  for (const [path, label] of [
    [userConfigPath(), "user config"],
    [projectConfigPath(cwd), "project config"],
  ]) {
    let raw = readJson(path);
    // A .clawline.json arrives with whatever repo you clone, and custom.command runs through a
    // shell on every render. Only your own config can set it, unless that config says
    // "allowProjectCommands": true.
    if (raw && !raw.__error && label === "user config") config.allowProjectCommands = raw.allowProjectCommands === true;
    const custom = raw?.segments?.custom;
    if (custom && typeof custom === "object" && "command" in custom && label === "project config" && !config.allowProjectCommands) {
      raw = structuredClone(raw);
      delete raw.segments.custom.command;
      warnings.push(
        `${path} sets custom.command, which a project config may not do; set "allowProjectCommands": true in ${userConfigPath()} to allow it`,
      );
    }
    if (raw) {
      mergeInto(config, raw, warnings, label);
      if (!raw.__error) sources.push(path);
    }
  }

  warnings.push(...validate(config));
  return { config, warnings, sources };
}

// Written config stays minimal: only what differs from the defaults.
export function serialize(config) {
  const base = defaults();
  const out = {
    $schema: "https://raw.githubusercontent.com/adlakhavansh/clawline/main/schema.json",
    theme: config.theme,
    rows: config.rows,
  };
  if (config.separator !== base.separator) out.separator = config.separator;
  if (config.padding !== base.padding) out.padding = config.padding;

  const segments = {};
  for (const [id, opts] of Object.entries(config.segments)) {
    const defaultOpts = base.segments[id] || {};
    const changed = {};
    for (const [k, v] of Object.entries(opts)) {
      if (JSON.stringify(v) !== JSON.stringify(defaultOpts[k])) changed[k] = v;
    }
    if (Object.keys(changed).length) segments[id] = changed;
  }
  if (Object.keys(segments).length) out.segments = segments;
  if (config.allowProjectCommands) out.allowProjectCommands = true;
  return out;
}

export function saveConfig(config, { scope = "user", cwd = process.cwd() } = {}) {
  const path = scope === "project" ? projectConfigPath(cwd) : userConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(serialize(config), null, 2)}\n`);
  return path;
}

export function segmentOptions(config, id) {
  const base = BY_ID.get(id)?.options || {};
  return { ...base, ...(config.segments?.[id] || {}) };
}

export function enabledIds(config) {
  return config.rows.flat().filter((id) => BY_ID.has(id));
}
