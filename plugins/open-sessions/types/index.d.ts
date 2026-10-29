export type SessionStatus = 'idle' | 'busy' | 'waiting'

export type OpenSession = {
  sessionId: string
  name: string
  cwd: string
  status: SessionStatus
  waitingFor?: string
  /** Epoch ms of the last status change, as the session file reports it. */
  since?: number
  /** The chat's title (`/rename`, else the generated one); absent until it has one. */
  title?: string
  entrypoint: string
  hostSessionId?: string
  /** A Remote Control session's id in the account (`cse_…`); absent for this PC's own. */
  remoteId?: string
  host: string
  isSelf: boolean
}

export type SessionsView = {
  host: string
  sessions: OpenSession[]
  note?: string
}

export type UsageLimit = {
  /** `five_hour`, `seven_day`, or a gateway's `spend_limit`. */
  kind: string
  percentUsed: number
  /** ISO 8601; absent when the API reported none. */
  resetsAt?: string
}

export type UsageView = {
  /** This session's context fill; null until the first response reports one. */
  ctxPercent: number | null
  /** Context window size in tokens. */
  window: number
  limits: UsageLimit[]
}

export type SubagentRow = {
  id: string
  /** The Agent call's description, else its type. */
  label: string
  type: string
  /** An AgentStatus: pending, running, waiting, idle, completed, failed or killed. */
  status: string
  /** Short display name (`Sonnet 5.5`); absent when spawned before the mod loaded. */
  model?: string
}

declare module 'claude-code' {
  interface PluginState {
    'open-sessions': {
      view: Shaped<SessionsView>
      usage: Shaped<UsageView>
      subagents: Shaped<SubagentRow[]>
      /** Section id → collapsed. */
      collapsed: Shaped<Record<string, boolean>>
      /** `<host>/<sessionId>` of sessions that went from busy to free and were not looked at yet. */
      unseen: Shaped<Record<string, boolean>>
    }
  }
}
