// Patches the `statusLine` key in Claude Code settings and nothing else.

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeDir } from "./config.mjs";
import { TIME_BASED } from "./segments/index.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(ROOT, "bin", "clawline.mjs");

// Git Bash eats unquoted backslashes in the command string, so paths go in with forward slashes.
export const toPosix = (p) => p.replace(/\\/g, "/");

export const settingsPath = ({ scope = "user", cwd = process.cwd() } = {}) =>
  scope === "project" ? join(cwd, ".claude", "settings.json") : join(claudeDir(), "settings.json");

// `npx clawline` runs from npm's cache, which gets cleaned, so the status line cannot point
// there. Running npx on every render is no fix either: it takes 0.5-1.5s, and Claude Code
// cancels a status line that is still running when the next update arrives. An npx install
// copies itself here instead, and running `npx clawline` again refreshes the copy.
export const appDir = () => join(claudeDir(), "clawline-app");
export const fromNpx = (path) => /[\\/]_npx[\\/]/.test(path);

// Copied next to the old one first, so a copy that fails halfway never replaces a working app.
export function copyApp(from = ROOT, to = appDir()) {
  const next = `${to}.next`;
  rmSync(next, { recursive: true, force: true });
  for (const part of ["bin", "src", "data", "package.json"]) {
    cpSync(join(from, part), join(next, part), { recursive: true });
  }
  rmSync(to, { recursive: true, force: true });
  renameSync(next, to);
  return to;
}

// Quoted for the shell Claude Code runs it through. Outside Windows, a path holding $, ` or "
// is escaped too, or the shell would expand it.
export function commandString(bin = BIN, platform = process.platform) {
  const target = toPosix(fromNpx(bin) ? join(appDir(), "bin", "clawline.mjs") : bin);
  const quoted = platform === "win32" ? target : target.replace(/(["$`\\])/g, "\\$1");
  return `node "${quoted}" --render`;
}

export function statusLineEntry(config) {
  const entry = { type: "command", command: commandString() };
  if (config?.padding) entry.padding = config.padding;
  const ids = (config?.rows || []).flat();
  if (ids.some((id) => TIME_BASED.has(id))) entry.refreshInterval = 10;
  return entry;
}

function readSettings(path) {
  let settings;
  try {
    settings = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    if (err?.code === "ENOENT") return {};
    throw new Error(`${path} is not valid JSON (${err.message}) — fix it before installing`);
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`${path} is not a JSON object — fix it before installing`);
  }
  return settings;
}

// Through a rename: an install killed halfway must not leave Claude Code a half-written settings file.
function writeSettings(path, settings) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.clawline-${process.pid}`;
  const body = `${JSON.stringify(settings, null, 2)}\n`;
  writeFileSync(tmp, body);
  try {
    renameSync(tmp, path);
  } catch {
    // Windows refuses to rename over a file another process has open; write it in place then.
    writeFileSync(path, body);
    rmSync(tmp, { force: true });
  }
}

export function install(config, { scope = "user", cwd = process.cwd() } = {}) {
  const path = settingsPath({ scope, cwd });
  const settings = readSettings(path);
  const before = settings.statusLine ? { ...settings.statusLine } : null;

  const backup = `${path}.clawline.bak`;
  if (existsSync(path) && !existsSync(backup)) {
    writeFileSync(backup, readFileSync(path));
  }

  if (fromNpx(BIN)) copyApp();
  settings.statusLine = statusLineEntry(config);
  writeSettings(path, settings);
  return { path, backup: existsSync(backup) ? backup : null, before, after: settings.statusLine };
}

export function uninstall({ scope = "user", cwd = process.cwd() } = {}) {
  const path = settingsPath({ scope, cwd });
  const settings = readSettings(path);
  const before = settings.statusLine ? { ...settings.statusLine } : null;
  if (!before) return { path, removed: false, before };
  delete settings.statusLine;
  writeSettings(path, settings);
  return { path, removed: true, before };
}

export function installedEntry({ scope = "user", cwd = process.cwd() } = {}) {
  try {
    return readSettings(settingsPath({ scope, cwd })).statusLine || null;
  } catch {
    return null;
  }
}
