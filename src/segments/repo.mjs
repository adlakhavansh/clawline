// Repository state: branch, pull request, lines changed.

import { paint, osc8 } from "../ansi.mjs";
import { gitState } from "../git.mjs";

const PR_ROLE = {
  approved: "good",
  changes_requested: "bad",
  pending: "muted",
  draft: "muted",
};

export const git = {
  id: "git",
  label: "git",
  hint: "branch, dirty file count, ahead/behind, conflicts",
  icon: "\u{E725}",
  priority: 6,
  shrinks: 8,
  defaultRow: 1,
  options: { showCounts: true, showAheadBehind: true, showSha: false, showConflicts: true, icon: "" },
  sample: (t) => paint(t.git, "main") + " " + paint(t.warn, "±3") + " " + paint(t.good, "↑1"),
  render({ data, cfg, theme, cwd }) {
    const g = gitState(cwd);
    const branch = data.worktree?.branch || g.branch;
    if (!g.repo && !branch) return "";
    const parts = [paint(theme.git, `${cfg.icon || ""}${branch || "no-branch"}`)];

    if (cfg.showCounts) {
      const dirty = g.staged + g.unstaged;
      if (dirty) parts.push(paint(theme.warn, `±${dirty}`));
      if (g.untracked) parts.push(paint(theme.muted, `?${g.untracked}`));
    }
    if (cfg.showConflicts && g.conflicts) parts.push(paint(theme.crit, `✕${g.conflicts}`));
    if (cfg.showAheadBehind) {
      if (g.ahead) parts.push(paint(theme.good, `↑${g.ahead}`));
      if (g.behind) parts.push(paint(theme.bad, `↓${g.behind}`));
    }
    if (cfg.showSha && g.sha) parts.push(paint(theme.muted, g.sha));
    return parts.join(" ");
  },
};

export const pr = {
  id: "pr",
  label: "pr",
  hint: "open pull request or merge request, with review state",
  icon: "\u{F407}",
  priority: 5,
  defaultRow: null,
  options: { link: true, showState: true },
  sample: (t) => paint(t.pr, "#1234") + " " + paint(t.good, "approved"),
  render({ data, cfg, theme }) {
    if (!data.pr?.number) return "";
    const marker = data.pr.kind === "mr" ? "!" : "#";
    const label = `${marker}${data.pr.number}`;
    let out = paint(theme.pr, cfg.link && data.pr.url ? osc8(data.pr.url, label) : label);
    if (cfg.showState && data.pr.review_state) {
      out += " " + paint(theme[PR_ROLE[data.pr.review_state] || "muted"], data.pr.review_state);
    }
    return out;
  },
};

export const diff = {
  id: "diff",
  label: "diff",
  hint: "lines added and removed this session",
  icon: "\u{F440}",
  priority: 3,
  defaultRow: null,
  options: {},
  sample: (t) => paint(t.add, "+156") + paint(t.muted, "/") + paint(t.del, "-23"),
  render({ data, theme }) {
    const add = data.cost?.total_lines_added || 0;
    const del = data.cost?.total_lines_removed || 0;
    if (!add && !del) return "";
    return paint(theme.add, `+${add}`) + paint(theme.muted, "/") + paint(theme.del, `-${del}`);
  },
};
