# clawline

A status line for [Claude Code](https://code.claude.com/docs) that you assemble yourself. Run it,
tick the segments you want in a checkbox list, hit enter. It writes the config, patches
`settings.json`, and gets out of the way.

![The clawline status line: model, directory, git branch, a context bar and a 5-hour limit bar on the first row; tokens, weekly limit, cost and a tip on the second](https://raw.githubusercontent.com/adlakhavansh/clawline/main/assets/statusline.png)

```
Opus 5·xhigh  clawline  master ?12  ctx ██░░░░░░░░ 22%  5h █░░░░░░░░░ 5%
219k/1.0M  wk 29% 5d18h  $10.8  tip esc esc rewinds the conversation
```

Every bar is optional and lives wherever you put it — context, the 5-hour window, the weekly
window, all of them or none.

Nineteen segments, four themes, zero runtime dependencies, one JSON file you can commit.

## Why another one

[ccstatusline](https://github.com/sirmalloc/ccstatusline) and
[claude-powerline](https://github.com/Owloops/claude-powerline) are both good and both bigger.
clawline exists for three things neither does:

- **Permission mode on the line.** Claude Code does not put the permission mode in the status line
  payload, so no other status line shows it. clawline reads it out of the session transcript, which
  means `plan`, `auto`, `accept-edits` and `bypass` are visible at a glance — including the one you
  forgot you turned on.
- **Tips that react to your session.** Context past 75% asks for `/compact`. A cold prompt cache
  says so. Conflicts, unpushed commits and a weekly limit at 85% each get their own nudge. When
  nothing is wrong you get a rotating Claude Code tip instead.
- **One flat checkbox list.** No menu tree, no React, no Ink. Arrow keys, space, enter.

## Install

```bash
npx clawline            # pick segments, then it installs itself
```

npx runs from npm's cache, which gets cleaned, so clawline copies itself to
`~/.claude/clawline-app` and points the status line there. Run `npx clawline` again to update.

Or from a clone:

```bash
git clone https://github.com/adlakhavansh/clawline
cd clawline
node bin/clawline.mjs   # same picker, installs the local path
```

Node 18 or newer. Nothing else to install — no dependencies, no build step.

## The picker

```
clawline  pick your segments   theme dark · rows 2 · user config

› [x] 1  model        model name, effort level, fast mode
  [x] 1  mode         plan
  [x] 2  context      ████░░░░░░ 38% 77k/200k
  [ ] -  tokens       in 8.5k · out 1.2k
  [x] 2  rate-5h      5h 24% 2h11m
  [x] 2  rate-week    wk 41% 3d
  [x] 2  cost         $1.23
  [ ] -  burn         +12k/min $0.9/h
  ...

preview
  Opus·xhigh  plan  clawline  main ±3 ↑1
  ████░░░░░░ 38% 77k/200k  5h 24% 2h11m  wk 41% 3d  $1.23  tip esc esc rewinds…

space toggle · 1/2 row · J/K reorder · t theme · r rows · s scope · enter save · q quit
```

| Key | Does |
|---|---|
| `↑` `↓` or `k` `j` | move the cursor |
| `space` | turn a segment on or off |
| `1` `2` | put the segment on row 1 or row 2 |
| `tab` | send it to the other row |
| `J` `K` | reorder it within its row |
| `t` | cycle theme: dark, light, nord, mono |
| `r` | one row or two |
| `s` | write to your user config or this project's |
| `enter` | save, install, show the result |
| `q` | leave without saving |

## Changing it without a terminal

The picker needs a real TTY, which you do not have inside Claude Code or over a plain pipe. Every
change is also a flag, and each one saves the config and re-installs in a single step:

```bash
clawline --show                   # current config, and every option you can set
clawline --toggle git             # on if off, off if on
clawline --on burn --off cost     # explicit
clawline --row tips 1             # move a segment to row 1
clawline --theme nord             # dark, light, nord, mono
clawline --set context.width=14   # any option from --show
```

### Inside Claude Code

Two ways, because Claude Code keybindings map to its own actions (`chat:cycleMode`,
`app:toggleTodos`, …) and cannot run a shell command, so no keypress can open the terminal picker.

**The pane.** `plugin/clawline-pane` is a Claude Code plugin that draws the same checkbox list in a
pane, inside the session.

![The clawline pane: every segment as a checkbox row with the row it sits in, the two rows summarised below, and theme, reload and close controls](https://raw.githubusercontent.com/adlakhavansh/clawline/main/assets/pane.png)
 Load it with `claude --plugin-dir <path to>/clawline/plugin`, then run
`/clawline-pane`. Every segment is a row; pressing one cycles it off, row 1, row 2; the theme
button cycles themes; reload re-reads the config. It shells out to this CLI, so the config file
stays the single source of truth.

**The slash command.** Copy `commands/clawline.md` into `~/.claude/commands/` and type what you
want:

```
/clawline                      show the current config
/clawline hide git
/clawline add burn to row 2
/clawline theme nord
/clawline context width 14
```

Claude translates it into the flags above and runs them.

### Outside Claude Code

Put `clawline` on your PATH (`npm i -g clawline`, or `npm link` from a clone) and bind it in your
terminal or shell instead, where a real keybinding is possible. Windows Terminal, for example:

```json
{ "command": { "action": "newTab", "commandline": "clawline" }, "keys": "ctrl+shift+l" }
```

## Segments

| id | Shows | Needs |
|---|---|---|
| `model` | `Opus·xhigh`, `⚡` in fast mode | — |
| `mode` | `plan` / `auto` / `accept-edits` / `bypass`, plus vim mode | readable transcript |
| `context` | bar, percent, exact tokens out of the window | after the first API call |
| `tokens` | `in 8.5k · out 1.2k · cached 68k` | after the first API call |
| `rate-5h` | 5-hour limit used, time to reset | Pro or Max plan |
| `rate-week` | 7-day limit used, plus spend limit when one applies | Pro or Max plan |
| `cost` | estimated session cost | — |
| `duration` | wall-clock session time, optionally the API share | — |
| `burn` | context fill rate and spend per hour | two renders apart |
| `diff` | lines added and removed this session | — |
| `dir` | folder name, or path relative to the project root | — |
| `git` | branch, dirty count, untracked, conflicts, ahead/behind, SHA | git on PATH |
| `pr` | open PR or GitLab MR with review state, clickable | an open PR |
| `cache` | prompt cache warm or cold, hit ratio | Claude Code 2.1.251+ |
| `tips` | state-aware nudge, else a rotating tip | — |
| `session` | session name or short id, agent name | — |
| `version` | Claude Code version | — |
| `custom` | first line of any shell command, cached | your command |
| `text` | a fixed label of your own | — |

On by default: `model`, `mode`, `dir`, `git` on row 1; `context`, `rate-5h`, `rate-week`, `cost`,
`tips` on row 2.

## Config

`~/.claude/clawline.json`, overridden by `.clawline.json` in the project you are working in. The
picker writes it, but it is plain JSON and `schema.json` describes every key:

```json
{
  "theme": "dark",
  "rows": [
    ["model", "mode", "dir", "git"],
    ["context", "rate-5h", "rate-week", "cost", "tips"]
  ],
  "segments": {
    "context": { "bar": true, "width": 10, "glyphs": "blocks", "showTokens": true, "warnAt": 75 },
    "git": { "showSha": true },
    "tips": { "contextAware": true, "rotate": "prompt", "file": "~/.claude/tips.txt" },
    "custom": { "command": "kubectl config current-context", "ttl": 60, "label": "k8s" }
  }
}
```

`rows` is the enable list: a segment that is not in a row is off. Order inside a row is the order
on screen. Unknown ids are reported by `--doctor` and skipped at render time, so an old config
never breaks the line.

Per-segment options worth knowing:

- `context`: `bar`, `width`, `glyphs` (`blocks`, `bars`, `dots`, `ascii`), `showPercent`,
  `showTokens`, `warnAt`, and `label` for a prefix such as `ctx` ahead of the bar
- `rate-5h` and `rate-week`: `bar`, `width`, `glyphs`, `showReset`, and `includeSpendLimit` on the
  weekly one. The bar is off by default on both — put it wherever you want it, or nowhere:
  `clawline --set rate-5h.bar=true --set context.bar=false`
- `tokens`: `style` — `usage` for `in / out / cached`, or `window` for `219k/1.0M`, which is what
  belongs on a second row under a context bar. `showCache` applies to usage style only.
- `mode`: `quiet` hides `default` and `auto` and still shows `plan`, `accept-edits` and `bypass`,
  so the chip only appears when the permission mode changes what Claude may do. `showOutputStyle`
  adds the output style beside it.
- `tips`: `contextAware`, `rotate` (`prompt` or `time`), `rotateSeconds` for time rotation,
  `file` for your own one-per-line tips, `maxWidth`, `prefix`
- `git`: `showCounts`, `showAheadBehind`, `showSha`, `showConflicts`, `icon`
- `dir`: `style` (`basename`, `relative`, `full`), `showWorktree`
- `custom`: `command`, `ttl` seconds, `label`, `maxWidth`
- `duration`: `showApiShare`

`custom.command` runs through a shell, by design, so pipes and globs work. It is your own config
file; nothing from the session payload is ever interpolated into it.

## CLI

```bash
clawline              # the picker
clawline --render     # what Claude Code runs; session JSON on stdin
clawline --print test/fixtures/mid-session.json   # render a saved payload
clawline --install    # write the statusLine entry
clawline --uninstall  # remove it again
clawline --doctor     # check config, settings, git, node, and time a render
clawline --list       # every segment id with its description
clawline --show       # current config plus every segment option
clawline --project    # act on ./.claude/settings.json and ./.clawline.json

clawline --toggle <id> | --on <id> | --off <id>
clawline --row <id> <1-4>
clawline --theme dark|light|nord|mono
clawline --set <id>.<option>=<value>
```

`NO_COLOR=1` turns off every escape sequence. `COLUMNS` controls the width clawline fits to —
Claude Code sets it for you.

## Notes

- **Rate limits** only appear for Pro and Max plans, and only after the first API response of a
  session. The segments stay empty otherwise rather than printing zeros.
- **Context percentage** is input-only (`input + cache_creation + cache_read`), matching how Claude
  Code computes its own `used_percentage`. It reads `—` before the first call and right after
  `/compact`, because there is genuinely no number yet.
- **Windows:** Claude Code runs the status line through Git Bash when it is installed, and Git Bash
  eats unquoted backslashes in the command path. The installer always writes forward slashes.
  `--doctor` fails loudly if it ever finds a backslash in there.
- **Speed:** git state is cached in the temp directory for two seconds and the whole render is
  asserted under 100ms in the test suite, because Claude Code cancels a status line that is still
  running when the next update arrives. That is also why the installed command is plain
  `node <path>` and never `npx`: npx alone takes 0.5–1.5s per render.
- **Themes:** `dark`, `light`, `nord`, `mono`. `mono` uses no colour at all beyond bold and dim.

## Development

```bash
npm test                     # fixtures for fresh, mid-session, post-compact, 1M context
node scripts/gen-schema.mjs  # regenerate schema.json from the segment registry
```

A segment is a small module exporting `{ id, label, hint, defaultRow, options, sample, render }`
and registered in `src/segments/index.mjs`. The picker, the renderer, the schema generator and the
tests all read that one registry, so adding a segment is one file plus one line.

MIT.
