export type SessionStatus = 'idle' | 'busy' | 'waiting'

export type OpenSession = {
  sessionId: string
  name: string
  cwd: string
  status: SessionStatus
  waitingFor?: string
  entrypoint: string
  hostSessionId?: string
  host: string
  isSelf: boolean
}

export type SessionsView = {
  host: string
  sessions: OpenSession[]
  note?: string
}

declare module 'claude-code' {
  interface PluginState {
    'open-sessions': { view: Shaped<SessionsView> }
  }
}
