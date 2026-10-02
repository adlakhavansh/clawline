// Patches the `statusLine` key in Claude Code settings and nothing else.

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from "node:fs";
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

export function copyApp(from = ROOT, to = appDir()) {
  rmSync(to, { recursive: true, force: true });
  for (const part of ["bin", "src", "data", "package.json"]) {
    cpSync(join(from, part), join(to, part), { recursive: true });
  }
  return to;
}

export function commandString(bin = BIN) {
  const target = fromNpx(bin) ? join(appDir(), "bin", "clawline.mjs") : bin;
  return `node "${toPosix(target)}" --render`;
}

export function statusLineEntry(config) {
  const entry = { type: "command", command: commandString() };
  if (config?.padding) entry.padding = config.padding;
  const ids = (config?.rows || []).flat();
  if (ids.some((id) => TIME_BASED.has(id))) entry.refreshInterval = 10;
  return entry;
}

function readSettings(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    if (err?.code === "ENOENT") return {};
    throw new Error(`${path} is not valid JSON (${err.message}) — fix it before installing`);
  }
}

function writeSettings(path, settings) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
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
