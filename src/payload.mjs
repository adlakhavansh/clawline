// The session JSON is Claude Code's, but some of its strings hold what a person or a repo put
// there: a session name, a folder name, a branch. Every string loses its control characters, so
// nothing in the payload can clear the screen, move the cursor or open a link, and no string
// runs past 4096 characters, the longest path a status line could need. Numbers that are
// not finite are dropped, and so is a known field of the wrong type, so a segment never prints
// NaN or [object Object]. Fields this table does not know pass through, cleaned.

const S = "string";
const N = "number";
const B = "boolean";
const O = "object";
const A = "array";

const SHAPE = {
  session_id: S, session_name: S, prompt_id: S, transcript_path: S, cwd: S, version: S,
  exceeds_200k_tokens: B, fast_mode: B,
  model: O, "model.id": S, "model.display_name": S,
  workspace: O, "workspace.current_dir": S, "workspace.project_dir": S, "workspace.added_dirs": A,
  "workspace.git_worktree": S, "workspace.repo": O, "workspace.repo.host": S,
  "workspace.repo.owner": S, "workspace.repo.name": S,
  output_style: O, "output_style.name": S,
  cost: O, "cost.total_cost_usd": N, "cost.total_duration_ms": N, "cost.total_api_duration_ms": N,
  "cost.total_lines_added": N, "cost.total_lines_removed": N,
  context_window: O, "context_window.total_input_tokens": N, "context_window.total_output_tokens": N,
  "context_window.context_window_size": N, "context_window.used_percentage": N,
  "context_window.remaining_percentage": N, "context_window.current_usage": O,
  "context_window.current_usage.input_tokens": N, "context_window.current_usage.output_tokens": N,
  "context_window.current_usage.cache_creation_input_tokens": N,
  "context_window.current_usage.cache_read_input_tokens": N,
  effort: O, "effort.level": S, thinking: O, "thinking.enabled": B,
  rate_limits: O,
  "rate_limits.five_hour": O, "rate_limits.five_hour.used_percentage": N, "rate_limits.five_hour.resets_at": N,
  "rate_limits.seven_day": O, "rate_limits.seven_day.used_percentage": N, "rate_limits.seven_day.resets_at": N,
  "rate_limits.spend_limit": O, "rate_limits.spend_limit.used_percentage": N,
  "rate_limits.spend_limit.resets_at": N, "rate_limits.spend_limit.used_usd": N,
  "rate_limits.spend_limit.limit_usd": N, "rate_limits.spend_limit.period": S,
  prompt_cache: O, "prompt_cache.warm": B, "prompt_cache.caching_observed": B, "prompt_cache.ttl": S,
  "prompt_cache.expires_at": N, "prompt_cache.requests": N, "prompt_cache.misses": N,
  "prompt_cache.hit_ratio": N, "prompt_cache.recache_tokens_if_cold": N,
  "prompt_cache.last_miss_cause": O, "prompt_cache.last_miss_cause.causes": A,
  vim: O, "vim.mode": S, agent: O, "agent.name": S,
  pr: O, "pr.number": N, "pr.url": S, "pr.review_state": S, "pr.kind": S,
  worktree: O, "worktree.name": S, "worktree.path": S, "worktree.branch": S,
  "worktree.original_cwd": S, "worktree.original_branch": S,
};

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const kind = (v) => (Array.isArray(v) ? A : typeof v);

export function clean(value, path = "") {
  if (typeof value === "string") return value.slice(0, 4096).replace(CONTROL, "");
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.map((v) => clean(v, `${path}[]`)).filter((v) => v !== undefined);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const at = path ? `${path}.${key}` : key;
    const v = clean(raw, at);
    if (v === undefined) continue;
    // null is how Claude Code says "not yet" (current_usage before the first call), so it stays.
    if (v !== null && SHAPE[at] && kind(v) !== SHAPE[at]) continue;
    out[key] = v;
  }
  return out;
}

export const cleanPayload = (data) => (data && typeof data === "object" && !Array.isArray(data) ? clean(data) : {});
