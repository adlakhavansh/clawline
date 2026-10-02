// One registry the renderer, the checkbox UI and the tests all read from.

import { model, mode, dir, session, version } from "./session.mjs";
import { context, tokens, rate5h, rateWeek, cost, duration, burn, cache } from "./usage.mjs";
import { git, pr, diff } from "./repo.mjs";
import { tips, custom, text } from "./extras.mjs";

export const SEGMENTS = [
  model,
  mode,
  context,
  tokens,
  rate5h,
  rateWeek,
  cost,
  duration,
  burn,
  diff,
  dir,
  git,
  pr,
  cache,
  tips,
  session,
  version,
  custom,
  text,
];

export const BY_ID = new Map(SEGMENTS.map((s) => [s.id, s]));

export const SEGMENT_IDS = SEGMENTS.map((s) => s.id);

// Segments whose text changes with the clock, so the installer knows when to ask Claude Code
// for a refresh timer.
export const TIME_BASED = new Set(["rate-5h", "rate-week", "burn", "duration", "custom", "tips"]);

export const defaultRows = () => [
  SEGMENTS.filter((s) => s.defaultRow === 1).map((s) => s.id),
  SEGMENTS.filter((s) => s.defaultRow === 2).map((s) => s.id),
];
