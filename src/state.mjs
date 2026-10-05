// Per-session scratch state in the temp dir, used for rates that need two samples.

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MIN_GAP_MS = 5000;
// The id only ever names a file in the temp dir: anything that could climb out of it is replaced.
const statePath = (sessionId) =>
  join(tmpdir(), `clawline-state-${String(sessionId || "nosession").replace(/[^\w.-]/g, "_").slice(0, 64)}.json`);

function read(sessionId) {
  try {
    return JSON.parse(readFileSync(statePath(sessionId), "utf8"));
  } catch {
    return null;
  }
}

function write(sessionId, value) {
  try {
    // A status line is killed when the next update arrives; a rename means never half a file.
    const path = statePath(sessionId);
    writeFileSync(`${path}.${process.pid}`, JSON.stringify(value));
    renameSync(`${path}.${process.pid}`, path);
  } catch {}
}

// Context fill rate (tokens/min) and spend rate ($/h). Tokens need two samples;
// spend falls back to the session totals, which are always available.
export function rates(sessionId, { tokens = 0, costUsd = 0, durationMs = 0 } = {}) {
  const now = Date.now();
  let prev = read(sessionId);
  // A sample from the future would freeze the rate until the clock caught up with it.
  if (prev && !(prev.at <= now && Number.isFinite(prev.tokens))) prev = null;
  let tokensPerMin = prev?.rate?.tokensPerMin ?? null;

  // An unknown count is not a sample. Recording it as one would measure the
  // whole context as a drop to zero, and that rate is then written to state and
  // read back on every later render.
  const known = Number.isFinite(tokens);
  const due = !prev || now - prev.at >= MIN_GAP_MS;

  if (known && prev && now - prev.at >= MIN_GAP_MS) {
    const minutes = (now - prev.at) / 60000;
    if (minutes > 0) tokensPerMin = Math.round((tokens - prev.tokens) / minutes);
  }

  if (known && due) {
    write(sessionId, { at: now, tokens, costUsd, rate: { tokensPerMin } });
  }

  const hours = durationMs / 3_600_000;
  const dollarsPerHour = hours > 0.01 ? costUsd / hours : null;
  return { tokensPerMin, dollarsPerHour };
}
