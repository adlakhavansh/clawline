// Per-session scratch state in the temp dir, used for rates that need two samples.

import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MIN_GAP_MS = 5000;
const statePath = (sessionId) =>
  join(tmpdir(), `clawline-state-${String(sessionId || "nosession").slice(0, 40)}.json`);

function read(sessionId) {
  try {
    return JSON.parse(readFileSync(statePath(sessionId), "utf8"));
  } catch {
    return null;
  }
}

function write(sessionId, value) {
  try {
    writeFileSync(statePath(sessionId), JSON.stringify(value));
  } catch {}
}

// Context fill rate (tokens/min) and spend rate ($/h). Tokens need two samples;
// spend falls back to the session totals, which are always available.
export function rates(sessionId, { tokens = 0, costUsd = 0, durationMs = 0 } = {}) {
  const now = Date.now();
  let prev = read(sessionId);
  // A sample from the future would freeze the rate until the clock caught up with it.
  if (prev && !(prev.at <= now)) prev = null;
  let tokensPerMin = prev?.rate?.tokensPerMin ?? null;

  if (prev && now - prev.at >= MIN_GAP_MS) {
    const minutes = (now - prev.at) / 60000;
    if (minutes > 0) tokensPerMin = Math.round((tokens - prev.tokens) / minutes);
  }

  if (!prev || now - prev.at >= MIN_GAP_MS) {
    write(sessionId, { at: now, tokens, costUsd, rate: { tokensPerMin } });
  }

  const hours = durationMs / 3_600_000;
  const dollarsPerHour = hours > 0.01 ? costUsd / hours : null;
  return { tokensPerMin, dollarsPerHour };
}
