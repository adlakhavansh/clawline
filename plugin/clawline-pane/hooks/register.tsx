import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PaneSegment, PaneView } from '../types'

const PANE = 'clawline'
const view = atom({ plugin: 'clawline-pane', key: 'view' } as const, null)

// The CLI is the single source of truth: this pane only reads --json and sends edits back.
const RUNNERS: readonly (readonly string[])[] = [['clawline'], ['npx', '-y', 'clawline']]

type RunResult = { ok: boolean; stdout: string; stderr: string }

async function runClawline($: EngineInterface, args: readonly string[]): Promise<RunResult> {
  let last: RunResult = { ok: false, stdout: '', stderr: 'clawline not found' }
  for (const runner of RUNNERS) {
    try {
      const child = $.process.spawn({ argv: [...runner, ...args] })
      let stdout = ''
      let stderr = ''
      for await (const piece of child) {
        if (piece.stream === 'stdout') stdout += piece.text
        else stderr += piece.text
      }
      const ended = await child.result
      last = { ok: ended.code === 0, stdout, stderr }
      if (last.ok) return last
    } catch (err) {
      last = { ok: false, stdout: '', stderr: String(err) }
    }
  }
  return last
}

async function loadView($: EngineInterface, status: string): Promise<PaneView> {
  const ran = await runClawline($, ['--json'])
  if (!ran.ok) {
    return {
      theme: 'dark',
      themes: [],
      segments: [],
      status: `clawline not reachable: ${ran.stderr.split('\n')[0] || 'unknown error'}`,
    }
  }
  const parsed = JSON.parse(ran.stdout) as {
    theme: string
    themes: string[]
    segments: { id: string; hint: string; row: number | null }[]
  }
  return {
    theme: parsed.theme,
    themes: parsed.themes,
    segments: parsed.segments.map(s => ({ id: s.id, hint: s.hint, row: s.row })),
    status,
  }
}

async function refresh($: EngineInterface, status: string): Promise<void> {
  const next = await loadView($, status)
  await update($, view, () => next)
}

// One press cycles a segment: off, then row 1, then row 2, then off again.
function nextStep(segment: PaneSegment): { args: string[]; said: string } {
  if (segment.row === null) return { args: ['--row', segment.id, '1'], said: `${segment.id} on row 1` }
  if (segment.row === 1) return { args: ['--row', segment.id, '2'], said: `${segment.id} on row 2` }
  return { args: ['--off', segment.id], said: `${segment.id} off` }
}

async function cycle($: EngineInterface, segment: PaneSegment): Promise<void> {
  const step = nextStep(segment)
  const ran = await runClawline($, step.args)
  await refresh($, ran.ok ? step.said : `failed: ${ran.stderr.split('\n')[0]}`)
}

async function cycleTheme($: EngineInterface, current: PaneView): Promise<void> {
  const themes = current.themes.length ? current.themes : ['dark']
  const wanted = themes[(themes.indexOf(current.theme) + 1) % themes.length]
  const ran = await runClawline($, ['--theme', wanted])
  await refresh($, ran.ok ? `theme ${wanted}` : `theme failed: ${ran.stderr.split('\n')[0]}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'clawline-pane',
      description: 'Open the clawline segment picker in a pane',
    })
    await refresh($, 'press a segment to cycle it: off, row 1, row 2')

    return next(e)
  })

  on('command.run', { command: 'clawline-pane' }, async $ => {
    await refresh($, 'press a segment to cycle it: off, row 1, row 2')
    await $.ui.open({ id: PANE, title: 'clawline', focus: true })

    return { text: 'clawline pane opened. Press a segment to cycle it between off, row 1 and row 2.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // Drawing is pure: this hook only reads. The reads are filled by session.start,
    // by the command, and by the reload button's press.
    const current = await read($, view)

    if (!current) {
      return (
        <Box flexDirection="column">
          <Text dimColor>no clawline config read yet</Text>
          <Button key="refresh" plain label="reload" onPress={() => void refresh($, 'reloaded')} />
        </Box>
      )
    }

    if (!current.segments.length) {
      return (
        <Box flexDirection="column">
          <Text color="red">{current.status}</Text>
          <Text dimColor>install it with: npm i -g clawline</Text>
          <Button key="refresh" label="retry" onPress={() => void refresh($, 'looking again')} />
        </Box>
      )
    }

    const width = Math.max(...current.segments.map(s => s.id.length)) + 1
    const rowOne = current.segments.filter(s => s.row === 1).map(s => s.id)
    const rowTwo = current.segments.filter(s => s.row === 2).map(s => s.id)

    return (
      <Box flexDirection="column">
        {current.segments.map(segment => (
          <Button
            key={`seg:${segment.id}`}
            plain
            dimColor={segment.row === null}
            label={`${segment.row === null ? '[ ] -' : `[x] ${segment.row}`}  ${segment.id.padEnd(width)} ${segment.hint}`}
            onPress={() => void cycle($, segment)}
          />
        ))}
        <Text> </Text>
        <Text dimColor>row 1  {rowOne.join(' ') || '(empty)'}</Text>
        <Text dimColor>row 2  {rowTwo.join(' ') || '(empty)'}</Text>
        <Text> </Text>
        <Box>
          <Button
            key="theme"
            plain
            label={`theme: ${current.theme}`}
            onPress={() => void cycleTheme($, current)}
          />
          <Text dimColor>   </Text>
          <Button key="refresh" plain label="reload" onPress={() => void refresh($, 'reloaded')} />
          <Text dimColor>   </Text>
          <Button key="close" plain label="close" onPress={() => void $.ui.close({ id: PANE }).catch(() => {})} />
        </Box>
        <Text dimColor>{current.status}</Text>
      </Box>
    )
  })
}
