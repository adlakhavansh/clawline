import { expect, test } from 'claude-code/testing'

const PLUGIN = 'clawline-pane'
const PANE = 'clawline'

const VIEW = {
  theme: 'dark',
  themes: ['dark', 'light', 'nord', 'mono'],
  rows: [['model'], ['context']],
  configPath: '/tmp/clawline.json',
  installed: true,
  warnings: [],
  segments: [
    { id: 'model', hint: 'model name, effort level, fast mode', row: 1, options: {} },
    { id: 'context', hint: 'context bar, percent used, exact tokens', row: 2, options: {} },
    { id: 'burn', hint: 'how fast context is filling', row: null, options: {} },
  ],
}

type On = Parameters<Parameters<typeof test>[1]>[1]
type Engine = Parameters<Parameters<typeof test>[1]>[0]

// The engine sits above these; the test is the bottom of every chain the pane uses.
// The fake CLI also means a test never touches the real ~/.claude/clawline.json.
function bottom(on: On, seen: string[][], exitCode = 0, onClose?: (id: string) => void) {
  on('process.spawn', async function* (_$, e) {
    seen.push([...e.argv])
    yield {
      stream: exitCode === 0 ? ('stdout' as const) : ('stderr' as const),
      text: exitCode === 0 ? JSON.stringify(VIEW) : 'not found',
    }

    return { value: { code: exitCode, signal: null } }
  })
  // ui.close resolves with nothing; answering with an object fails the chain.
  on('ui.close', async (_$, e) => {
    onClose?.(e.id)
  })
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text> </Text>
  })
}

// A pane opened outside the command starts empty; reload fills it, as a press may write state.
// Unmounting inside the test keeps the engine's own close under the test's own hooks.
async function withPane(
  $: Engine,
  surface: 'terminal' | 'desktop',
  body: (pane: Awaited<ReturnType<Engine['ui']['mount']>>) => Promise<void>,
) {
  const pane = await $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    props: {},
    requestId: PANE,
  })
  await pane.press({ key: 'refresh' })
  try {
    await body(pane)
  } finally {
    await pane.unmount()
  }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: every segment is drawn as a checkbox row`, async ($, on) => {
    const seen: string[][] = []
    bottom(on, seen)

    await withPane($, surface, async pane => {
      const buttons = await pane.findAll({ type: 'Button' })
      const rows = buttons.filter(button => String(button.key ?? '').startsWith('seg:'))

      expect(rows).toHaveLength(3)
      expect((await pane.find({ key: 'seg:model' }))?.text).toContain('[x] 1')
      expect((await pane.find({ key: 'seg:context' }))?.text).toContain('[x] 2')
      expect((await pane.find({ key: 'seg:burn' }))?.text).toContain('[ ] -')
      expect((await pane.find({ key: 'theme' }))?.text).toContain('dark')
      expect(seen.some(argv => argv.includes('--json'))).toBe(true)
    })
  })

  test(`${surface}: pressing a segment cycles it off, row 1, row 2`, async ($, on) => {
    const seen: string[][] = []
    bottom(on, seen)

    await withPane($, surface, async pane => {
      const sent = () => seen.map(argv => argv.join(' '))

      await pane.press({ key: 'seg:burn' })
      expect(sent().some(line => line.includes('--row burn 1'))).toBe(true)

      await pane.press({ key: 'seg:model' })
      expect(sent().some(line => line.includes('--row model 2'))).toBe(true)

      await pane.press({ key: 'seg:context' })
      expect(sent().some(line => line.includes('--off context'))).toBe(true)
    })
  })

  test(`${surface}: the theme control cycles to the next theme`, async ($, on) => {
    const seen: string[][] = []
    bottom(on, seen)

    await withPane($, surface, async pane => {
      await pane.press({ key: 'theme' })
      expect(seen.map(argv => argv.join(' ')).some(line => line.includes('--theme light'))).toBe(true)
    })
  })

  test(`${surface}: the close control closes the pane`, async ($, on) => {
    const seen: string[][] = []
    let closed: string | null = null
    bottom(on, seen, 0, id => {
      closed = id
    })

    await withPane($, surface, async pane => {
      await pane.press({ key: 'close' })
      expect(closed).toBe(PANE)
    })
  })

  test(`${surface}: a missing clawline shows the install hint instead of an empty pane`, async ($, on) => {
    bottom(on, [], 127)

    await withPane($, surface, async pane => {
      expect(JSON.stringify(await pane.drawn())).toContain('npm i -g clawline')
      expect(await pane.find({ key: 'refresh' })).toBeTruthy()
    })
  })
}
