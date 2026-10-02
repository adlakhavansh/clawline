// `clawline --doctor`: tells you what is wired up and what is not.

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { paint } from "./ansi.mjs";
import { loadConfig, userConfigPath, projectConfigPath, enabledIds } from "./config.mjs";
import { settingsPath, installedEntry, commandString } from "./install.mjs";
import { render } from "./render.mjs";
import { BY_ID } from "./segments/index.mjs";

const ok = (msg) => console.log(`${paint("32", "ok")}      ${msg}`);
const warn = (msg) => console.log(`${paint("33", "warn")}    ${msg}`);
const bad = (msg) => console.log(`${paint("31", "problem")} ${msg}`);

export async function doctor({ scope = "user", cwd = process.cwd() } = {}) {
  let healthy = true;

  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 18) ok(`node ${process.versions.node}`);
  else {
    bad(`node ${process.versions.node} is too old, clawline needs 18 or newer`);
    healthy = false;
  }

  const { config, warnings, sources } = loadConfig(cwd);
  if (sources.length) ok(`config ${sources.join(", ")}`);
  else warn(`no config file yet (defaults in use); run clawline to create ${userConfigPath()}`);
  if (existsSync(projectConfigPath(cwd))) ok(`project config ${projectConfigPath(cwd)}`);
  for (const w of warnings) warn(w);

  const ids = enabledIds(config);
  if (ids.length) ok(`${ids.length} segments enabled: ${ids.join(", ")}`);
  else {
    bad("no segments enabled, the status line would be blank");
    healthy = false;
  }
  const unknown = config.rows.flat().filter((id) => !BY_ID.has(id));
  if (unknown.length) {
    warn(`ignored unknown ids: ${unknown.join(", ")}`);
  }

  const path = settingsPath({ scope, cwd });
  const entry = installedEntry({ scope, cwd });
  if (!entry) {
    warn(`no statusLine in ${path}; run clawline --install`);
    healthy = false;
  } else if (entry.command !== commandString()) {
    warn(`${path} points somewhere else: ${entry.command}`);
  } else {
    ok(`statusLine wired in ${path}`);
  }
  if (entry?.command?.includes("\\")) {
    bad("the command path contains backslashes; Git Bash will eat them. Re-run clawline --install");
    healthy = false;
  }

  try {
    execFileSync("git", ["--version"], { stdio: "ignore", timeout: 1500 });
    ok("git found");
  } catch {
    warn("git not on PATH, the git segment will stay empty");
  }

  const fixture = fileURLToPath(new URL("../test/fixtures/mid-session.json", import.meta.url));
  if (existsSync(fixture)) {
    const data = JSON.parse(readFileSync(fixture, "utf8"));
    const started = Date.now();
    const rows = render(data, { config, columns: process.stdout.columns || 120 });
    const ms = Date.now() - started;
    (ms < 100 ? ok : warn)(`sample render in ${ms}ms`);
    console.log("");
    for (const row of rows) console.log(`  ${row}`);
  }

  return healthy;
}
