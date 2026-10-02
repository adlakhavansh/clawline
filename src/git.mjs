// Git state in one `git status --porcelain=v2 --branch` call, cached in the temp dir
// because the status line re-renders on every assistant message.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TTL_MS = 2000;
const EMPTY = {
  repo: false, branch: "", sha: "", staged: 0, unstaged: 0, untracked: 0,
  conflicts: 0, ahead: 0, behind: 0, detached: false,
};

const cachePath = (cwd) =>
  join(tmpdir(), `clawline-git-${createHash("sha1").update(cwd).digest("hex").slice(0, 12)}.json`);

function readCache(cwd) {
  try {
    const c = JSON.parse(readFileSync(cachePath(cwd), "utf8"));
    // An entry stamped in the future (a clock that jumped back, a test that faked it) is stale.
    const age = Date.now() - c.at;
    if (age >= 0 && age < TTL_MS) return c.value;
  } catch {}
  return null;
}

function writeCache(cwd, value) {
  try {
    writeFileSync(cachePath(cwd), JSON.stringify({ at: Date.now(), value }));
  } catch {}
}

export function parsePorcelainV2(out) {
  const g = { ...EMPTY, repo: true };
  for (const line of out.split("\n")) {
    if (!line) continue;
    if (line.startsWith("# branch.head ")) {
      const head = line.slice(14).trim();
      if (head === "(detached)") g.detached = true;
      else g.branch = head;
    } else if (line.startsWith("# branch.oid ")) {
      const oid = line.slice(13).trim();
      g.sha = oid === "(initial)" ? "" : oid.slice(0, 7);
    } else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+)\s+-(\d+)/.exec(line);
      if (m) {
        g.ahead = Number(m[1]);
        g.behind = Number(m[2]);
      }
    } else if (line[0] === "1" || line[0] === "2") {
      const xy = line.split(" ")[1] || "..";
      if (xy[0] !== ".") g.staged += 1;
      if (xy[1] !== ".") g.unstaged += 1;
    } else if (line[0] === "u") {
      g.conflicts += 1;
    } else if (line[0] === "?") {
      g.untracked += 1;
    }
  }
  if (g.detached && !g.branch) g.branch = g.sha ? `@${g.sha}` : "detached";
  return g;
}

export function gitState(cwd) {
  if (!cwd) return { ...EMPTY };
  const cached = readCache(cwd);
  if (cached) return cached;

  let value = { ...EMPTY };
  try {
    const out = execFileSync("git", ["status", "--porcelain=v2", "--branch"], {
      cwd,
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    });
    value = parsePorcelainV2(out);
  } catch {
    value = { ...EMPTY };
  }
  writeCache(cwd, value);
  return value;
}
