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

// The engine sits above these; the test is the bottom of every chain the pane uses.
// The fake CLI also means a test never touches the real ~/.claude/clawline.json.
function bottom(on: Parameters<Parameters<typeof test>[1]>[1], seen: string[][], exitCode = 0) {
  on('process.spawn', async function* (_$, e) {
    seen.push([...e.argv])
    yield {
      stream: exitCode === 0 ? ('stdout' as const) : ('stderr' as const),
      text: exitCode === 0 ? JSON.stringify(VIEW) : 'not found',
    }

    return { value: { code: exitCode, signal: null } }
  })
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text> </Text>
  })
}

// A pane opened outside the command starts empty; reload fills it, as a press may write state.
async function mount($: Parameters<Parameters<typeof test>[1]>[0], surface: 'terminal' | 'desktop') {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: {}, requestId: PANE })
  await pane.press({ key: 'refresh' })

  return pane
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: every segment is drawn as a checkbox row`, async ($, on) => {
    const seen: string[][] = []
    bottom(on, seen)

    const pane = await mount($, surface)
    const buttons = await pane.findAll({ type: 'Button' })
    const rows = buttons.filter(button => String(button.key ?? '').startsWith('seg:'))

    expect(rows).toHaveLength(3)
    expect((await pane.find({ key: 'seg:model' }))?.text).toContain('[x] 1')
    expect((await pane.find({ key: 'seg:context' }))?.text).toContain('[x] 2')
    expect((await pane.find({ key: 'seg:burn' }))?.text).toContain('[ ] -')
    expect((await pane.find({ key: 'theme' }))?.text).toContain('dark')
    expect(seen.some(argv => argv.includes('--json'))).toBe(true)
  })

  test(`${surface}: pressing a segment cycles it off, row 1, row 2`, async ($, on) => {
    const seen: string[][] = []
    bottom(on, seen)

    const pane = await mount($, surface)
    const sent = () => seen.map(argv => argv.join(' '))

    await pane.press({ key: 'seg:burn' })
    expect(sent().some(line => line.includes('--row burn 1'))).toBe(true)

    await pane.press({ key: 'seg:model' })
    expect(sent().some(line => line.includes('--row model 2'))).toBe(true)

    await pane.press({ key: 'seg:context' })
    expect(sent().some(line => line.includes('--off context'))).toBe(true)
  })

  test(`${surface}: the theme control cycles to the next theme`, async ($, on) => {
    const seen: string[][] = []
    bottom(on, seen)

    const pane = await mount($, surface)
    await pane.press({ key: 'theme' })

    expect(seen.map(argv => argv.join(' ')).some(line => line.includes('--theme light'))).toBe(true)
  })

  test(`${surface}: a missing clawline shows the install hint instead of an empty pane`, async ($, on) => {
    bottom(on, [], 127)

    const pane = await mount($, surface)

    expect(JSON.stringify(await pane.drawn())).toContain('npm i -g clawline')
    expect(await pane.find({ key: 'refresh' })).toBeTruthy()
  })
}
