#!/usr/bin/env node
// clawline CLI. `--render` is what Claude Code calls; bare `clawline` opens the checkbox UI.

import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const has = (...names) => names.some((n) => argv.includes(n));
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const scope = has("--project") ? "project" : "user";

const HELP = `clawline — configurable status line for Claude Code

  clawline                 open the checkbox picker, then install
  clawline --render        render one status line from session JSON on stdin
  clawline --print [file]  render a saved payload (or stdin) for a quick look
  clawline --install       write the statusLine entry into settings.json
  clawline --uninstall     remove the statusLine entry again
  clawline --doctor        check config, settings, git and node
  clawline --list          list every segment id
  clawline --show          print the current config and each segment's options

edits without a terminal (they save and reinstall straight away):

  clawline --toggle git            turn a segment on or off
  clawline --on burn --off cost    turn specific segments on or off
  clawline --row tips 1            move a segment to row 1
  clawline --theme nord            switch theme
  clawline --set context.width=16  set one segment option

  --project                act on ./.claude/settings.json and ./.clawline.json
  --theme <name>           with --render or --print, overrides the theme for that run only
`;

async function main() {
  if (has("--help", "-h")) {
    process.stdout.write(HELP);
    return;
  }
  if (has("--version", "-v")) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    console.log(pkg.version);
    return;
  }

  if (has("--render") || has("--print")) {
    const { render, readStdin } = await import("../src/render.mjs");
    const { loadConfig } = await import("../src/config.mjs");

    const file = has("--print") ? valueOf("--print") : undefined;
    const raw = file && !file.startsWith("--") ? readFileSync(file, "utf8") : readStdin();
    let data = {};
    try {
      data = JSON.parse(raw || "{}");
    } catch {
      data = {};
    }

    const cwd = data.workspace?.current_dir || data.cwd || process.cwd();
    const { config, warnings } = loadConfig(cwd);
    const themeOverride = valueOf("--theme");
    if (themeOverride) config.theme = themeOverride;

    for (const line of render(data, { config })) console.log(line);
    if (has("--print") && warnings.length) {
      for (const w of warnings) process.stderr.write(`clawline: ${w}\n`);
    }
    return;
  }

  if (has("--list")) {
    const { SEGMENTS } = await import("../src/segments/index.mjs");
    for (const s of SEGMENTS) console.log(`${s.id.padEnd(12)} ${s.hint}`);
    return;
  }

  const { hasEditFlags, parseEdits, applyEdit } = await import("../src/edit.mjs");
  if (hasEditFlags(argv) && !has("--render", "--print")) {
    const { loadConfig, saveConfig } = await import("../src/config.mjs");
    const { install } = await import("../src/install.mjs");
    const { config } = loadConfig();
    for (const edit of parseEdits(argv)) console.log(applyEdit(config, edit));
    config.rows = config.rows.filter((row) => row.length);
    console.log(`saved ${saveConfig(config, { scope })}`);
    install(config, { scope });
    console.log(`rows: ${config.rows.map((row) => row.join(" ")).join(" | ")}`);
    return;
  }

  // Machine-readable state, for anything that wants to drive clawline from outside:
  // the Claude Code pane plugin, an editor extension, a script.
  if (has("--json")) {
    const { loadConfig, segmentOptions, userConfigPath } = await import("../src/config.mjs");
    const { SEGMENTS } = await import("../src/segments/index.mjs");
    const { THEME_NAMES } = await import("../src/theme.mjs");
    const { installedEntry } = await import("../src/install.mjs");
    const { config, warnings, sources } = loadConfig();
    const rowOf = (id) => {
      const i = config.rows.findIndex((row) => row.includes(id));
      return i < 0 ? null : i + 1;
    };
    console.log(
      JSON.stringify(
        {
          theme: config.theme,
          themes: THEME_NAMES,
          rows: config.rows,
          configPath: sources[0] || userConfigPath(),
          installed: Boolean(installedEntry({ scope })),
          warnings,
          segments: SEGMENTS.map((s) => ({
            id: s.id,
            hint: s.hint,
            row: rowOf(s.id),
            options: segmentOptions(config, s.id),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (has("--show")) {
    const { loadConfig, serialize, enabledIds } = await import("../src/config.mjs");
    const { config, sources } = loadConfig();
    console.log(sources.length ? `config: ${sources.join(", ")}` : "config: defaults (no file yet)");
    console.log(JSON.stringify(serialize(config), null, 2));
    console.log("\noptions you can set with --set segment.option=value (current values):");
    const { SEGMENTS } = await import("../src/segments/index.mjs");
    const { segmentOptions } = await import("../src/config.mjs");
    const on = new Set(enabledIds(config));
    for (const segment of SEGMENTS) {
      const opts = Object.entries(segmentOptions(config, segment.id));
      const body = opts.length
        ? opts.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")
        : "no options";
      console.log(`  ${on.has(segment.id) ? "x" : " "} ${segment.id}: ${body}`);
    }
    return;
  }

  if (has("--install")) {
    const { loadConfig, saveConfig } = await import("../src/config.mjs");
    const { install } = await import("../src/install.mjs");
    const { config, sources } = loadConfig();
    // First install: leave a config file behind so there is something to edit or tick through.
    if (!sources.length) console.log(`config written to ${saveConfig(config, { scope })}`);
    const res = install(config, { scope });
    console.log(`clawline installed in ${res.path}`);
    console.log(JSON.stringify(res.after, null, 2));
    if (res.backup) console.log(`backup: ${res.backup}`);
    return;
  }

  if (has("--uninstall")) {
    const { uninstall } = await import("../src/install.mjs");
    const res = uninstall({ scope });
    console.log(res.removed ? `statusLine removed from ${res.path}` : `no statusLine in ${res.path}`);
    return;
  }

  if (has("--doctor")) {
    const { doctor } = await import("../src/doctor.mjs");
    process.exitCode = (await doctor({ scope })) ? 0 : 1;
    return;
  }

  const { runPicker } = await import("../src/tui.mjs");
  await runPicker({ scope });
}

main().catch((err) => {
  process.stderr.write(`clawline: ${err?.message || err}\n`);
  process.exitCode = 1;
});
