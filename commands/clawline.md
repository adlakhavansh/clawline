---
description: Show or change the clawline status line (segments, rows, theme, options)
argument-hint: [e.g. "hide git", "add burn to row 2", "theme nord", "context width 14"]
allowed-tools: Bash(clawline:*), Bash(node * clawline*)
---

The user wants to inspect or change their clawline status line. `$ARGUMENTS` is what they asked
for, in their own words, and may be empty.

clawline's picker is interactive and needs a real TTY, which this session does not have. Use the
non-interactive flags instead. Run `clawline --help` first if you need the current flag list.

1. Run `clawline --show` to see the current config and every segment option. (If `clawline` is not
   on PATH, call the repo directly: `node <repo>/bin/clawline.mjs --show`.)
2. Translate the request into one command, combining flags where it helps:
   - turn a segment on or off: `clawline --on <id>` / `--off <id>` / `--toggle <id>`
   - move a segment: `clawline --row <id> <1|2>`
   - theme: `clawline --theme dark|light|nord|mono`
   - any segment option: `clawline --set <id>.<option>=<value>`
   - `clawline --list` names every segment; `--show` lists each one's options
3. Run it. It saves the config and re-installs the `statusLine` entry in one step.
4. Show the result: run `clawline --print <repo>/test/fixtures/mid-session.json` so the user sees
   the new line, and say that the real one updates on the next assistant message.

With no arguments, just show the current config and the segment list, and say what can be changed.

Never edit `~/.claude/settings.json` by hand for this — `clawline --install` owns that key. If the
user asks to remove the status line entirely, use `clawline --uninstall`.
