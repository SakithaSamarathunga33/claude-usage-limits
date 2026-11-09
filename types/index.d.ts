export type Reading = {
  limits: { kind: string; percentUsed: number; resetsAt?: string }[]
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-limits': { reading: Reading | null }
  }
}
