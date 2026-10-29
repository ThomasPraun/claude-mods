/** Where the session runs and on what model. Refreshed at start and after each turn. */
export type BandInfo = {
  user: string
  /** Absolute path, `~` already substituted for HOME. */
  dir: string
  /** Null outside a git repo or on detached HEAD. */
  branch: string | null
  model: string
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      info: BandInfo | null
      title: string | null
      /** Agent tool_use_id → short model name; never pruned so transcript rows keep it. */
      callModels: Record<string, string>
    }
  }
}
