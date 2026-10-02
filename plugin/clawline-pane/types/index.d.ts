export type PaneSegment = {
  id: string
  hint: string
  /** 1 or 2 while enabled, null while off. */
  row: number | null
}

export type PaneView = {
  theme: string
  themes: string[]
  style: string
  /** Empty when the clawline on PATH predates styles. */
  styles: string[]
  icons: string
  segments: PaneSegment[]
  /** Last line of feedback: what changed, or what went wrong. */
  status: string
}

declare module 'claude-code' {
  interface PluginState {
    'clawline-pane': { view: PaneView | null }
  }
}
