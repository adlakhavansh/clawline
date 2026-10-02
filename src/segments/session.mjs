// Who you are talking to and where: model, permission mode, directory, version, session.

import { paint } from "../ansi.mjs";
import { permissionMode } from "../transcript.mjs";
import { basename, relative, sep } from "node:path";

const MODE_ROLE = {
  bypass: "crit",
  "accept-edits": "warn",
  plan: "mode",
  auto: "mode",
  default: "muted",
};

export const model = {
  id: "model",
  label: "model",
  hint: "model name, effort level, fast mode",
  defaultRow: 1,
  options: { showEffort: true, showId: false, showThinking: false },
  sample: (t) => paint(t.model, "Opus") + paint(t.muted, "·") + paint(t.model, "xhigh"),
  render({ data, cfg, theme }) {
    const name = cfg.showId ? data.model?.id : data.model?.display_name;
    if (!name) return "";
    let out = paint(theme.model, name);
    if (cfg.showEffort && data.effort?.level) {
      out += paint(theme.muted, "·") + paint(theme.model, data.effort.level);
    }
    if (cfg.showThinking && data.thinking?.enabled) out += paint(theme.muted, "·th");
    if (data.fast_mode) out += paint(theme.warn, " ⚡");
    return out;
  },
};

export const mode = {
  id: "mode",
  label: "mode",
  hint: "permission mode: plan, auto, accept-edits, bypass",
  defaultRow: 1,
  options: { showOutputStyle: false, quiet: false },
  sample: (t) => paint(t.mode, "plan"),
  render({ data, cfg, theme }) {
    const parts = [];
    const m = permissionMode(data.transcript_path);
    // quiet: say nothing while permissions are ordinary, speak up for the modes that change
    // what Claude may do without asking.
    const worthShowing = !cfg.quiet || !["default", "auto", ""].includes(m);
    if (m && worthShowing) parts.push(paint(theme[MODE_ROLE[m] || "mode"], m));
    if (cfg.showOutputStyle && data.output_style?.name && data.output_style.name !== "default") {
      parts.push(paint(theme.muted, data.output_style.name));
    }
    if (data.vim?.mode) parts.push(paint(theme.muted, data.vim.mode.toLowerCase()));
    return parts.join(paint(theme.muted, " · "));
  },
};

export const dir = {
  id: "dir",
  label: "dir",
  hint: "working directory, plus worktree name",
  defaultRow: 1,
  options: { style: "basename", showWorktree: true },
  sample: (t) => paint(t.dir, "clawline"),
  render({ data, cfg, theme, cwd }) {
    if (!cwd) return "";
    let shown;
    const projectDir = data.workspace?.project_dir;
    if (cfg.style === "full") {
      shown = cwd;
    } else if (cfg.style === "relative" && projectDir) {
      const rel = relative(projectDir, cwd);
      shown = rel && !rel.startsWith("..") ? `${basename(projectDir)}${sep}${rel}` : basename(cwd);
    } else {
      shown = basename(cwd.replace(/[\\/]+$/, "")) || cwd;
    }
    let out = paint(theme.dir, shown);
    const wt = data.worktree?.name || data.workspace?.git_worktree;
    if (cfg.showWorktree && wt) out += paint(theme.muted, ` (${wt})`);
    return out;
  },
};

export const session = {
  id: "session",
  label: "session",
  hint: "session name or id, and agent name when running one",
  defaultRow: null,
  options: { showAgent: true },
  sample: (t) => paint(t.muted, "statusline-build"),
  render({ data, cfg, theme }) {
    const parts = [];
    const name = data.session_name || (data.session_id ? data.session_id.slice(0, 8) : "");
    if (name) parts.push(paint(theme.muted, name));
    if (cfg.showAgent && data.agent?.name) parts.push(paint(theme.mode, `@${data.agent.name}`));
    return parts.join(paint(theme.muted, " "));
  },
};

export const version = {
  id: "version",
  label: "version",
  hint: "Claude Code version",
  defaultRow: null,
  options: {},
  sample: (t) => paint(t.muted, "v2.1.260"),
  render({ data, theme }) {
    return data.version ? paint(theme.muted, `v${data.version}`) : "";
  },
};
