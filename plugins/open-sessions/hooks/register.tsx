import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type {
  OpenSession,
  SessionStatus,
  SessionsView,
  SubagentRow,
  UsageLimit,
  UsageView,
} from '../types'

const PANE = 'open-sessions'
const LOCAL_POLL_MS = 3000
const REMOTE_POLL_MS = 30_000
// Group name for sessions reached through Remote Control: the account API does not say which PC runs them.
const REMOTE_HOST = 'Remote Control'
// Undocumented endpoint and beta Claude Code itself uses to list the account's sessions.
const SESSIONS_URL = 'https://api.anthropic.com/v1/code/sessions?limit=50'
const SESSIONS_BETA = 'ccr-byoc-2025-07-29'
// Titles live in transcripts of up to tens of MB, so each is searched at most this often.
const TITLE_REFRESH_MS = 30_000
const SOUND_FINISHED = 'sounds/finished.wav'
const SOUND_WAITING = 'sounds/waiting.wav'

const view = atom(
  { plugin: 'open-sessions', key: 'view' } as const,
  { host: '', sessions: [] },
  { shape: 'view-1' },
)

const usage = atom(
  { plugin: 'open-sessions', key: 'usage' } as const,
  { ctxPercent: null, window: 0, limits: [] },
  { shape: 'usage-1' },
)

const subagents = atom({ plugin: 'open-sessions', key: 'subagents' } as const, [], {
  shape: 'subagents-1',
})

const unseen = atom({ plugin: 'open-sessions', key: 'unseen' } as const, {}, {
  shape: 'unseen-1',
})

const sessionKey = (one: OpenSession) => `${one.host}/${one.sessionId}`

const markSeen = ($: EngineInterface, one: OpenSession) =>
  update($, unseen, all => {
    const { [sessionKey(one)]: _, ...rest } = all
    return rest
  })

const collapsed = atom({ plugin: 'open-sessions', key: 'collapsed' } as const, {}, {
  shape: 'collapsed-1',
})

// Hex rather than theme names: the desktop pane draws some theme names (warning, suggestion) as plain text.
const RED = '#e5786d'
const ORANGE = '#d7875f'
const BLUE = '#6aa6e8'
const GREEN = '#5fd75f'
const GREY = '#7a7a7a'

const ACTIVE_AGENT = new Set(['pending', 'running', 'waiting'])
// Finished subagents stay listed, dim, up to this many of the most recent.
const MAX_FINISHED_AGENTS = 5
const AGENT_LOOK: Record<string, { label: string; color: string }> = {
  pending: { label: 'en cola', color: GREY },
  running: { label: 'trabajando', color: ORANGE },
  waiting: { label: 'te espera', color: RED },
  idle: { label: 'en pausa', color: BLUE },
  completed: { label: 'terminado', color: GREEN },
  failed: { label: 'falló', color: RED },
  killed: { label: 'detenido', color: GREY },
}

// `claude-opus-5-5[1m]` → `Opus 5.5`; unknown shapes pass through without a `(… context)` suffix.
const shortModel = (model: string) => {
  const id = model.replace(/\[.*\]$/, '').match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/)
  if (id) {
    const [, family = '', major, minor] = id
    return `${family[0]?.toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
  }
  return model.replace(/\s*\(.*context\)\s*$/i, '')
}

const BAR_WIDTH = 10
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const LIMIT_LABELS: Record<string, string> = { five_hour: '5 h', seven_day: '7 días' }

// Percent used: under 50 is fine, under 80 is a warning, the rest is near the limit.
const levelColor = (used: number) => (used >= 80 ? RED : used >= 50 ? ORANGE : GREEN)

const formatSince = (since: number | undefined, now: number) => {
  if (since === undefined) return undefined
  const minutes = Math.max(0, Math.floor((now - since) / 60_000))
  if (minutes < 1) return 'recién'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

const formatWindow = (tokens: number) =>
  tokens >= 1_000_000 ? `${Math.round(tokens / 1_000_000)}M` : `${Math.round(tokens / 1000)}k`

const pad2 = (n: number) => String(n).padStart(2, '0')

// The 5-hour window resets within the day, so only its time is shown; longer ones add the weekday.
const formatReset = (limit: UsageLimit) => {
  if (!limit.resetsAt) return undefined
  const at = new Date(limit.resetsAt)
  if (Number.isNaN(at.getTime())) return undefined
  const time = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`
  return limit.kind === 'five_hour' ? time : `${DAYS[at.getDay()]} ${time}`
}

const toUsageView = (context: { percent?: number | null; window: number }, limits: UsageLimit[]): UsageView => ({
  ctxPercent: context.percent ?? null,
  window: context.window,
  limits: limits.map(({ kind, percentUsed, resetsAt }) => ({
    kind,
    percentUsed,
    ...(resetsAt !== undefined && { resetsAt }),
  })),
})

const ORDER: Record<SessionStatus, number> = { waiting: 0, busy: 1, idle: 2 }
const LOOK: Record<SessionStatus, { label: string; color: string }> = {
  waiting: { label: 'te espera', color: RED },
  busy: { label: 'ocupada', color: ORANGE },
  idle: { label: 'libre', color: BLUE },
}

// What a session waits on, as Claude Code names it, in the pane's language.
const WAITING_FOR: Record<string, string> = {
  'input needed': 'necesita respuesta',
  'dialog open': 'diálogo abierto',
  'worker request': 'pedido de un worker',
  'sandbox request': 'permiso de sandbox',
}

const toStatus = (raw: unknown): SessionStatus =>
  raw === 'busy' || raw === 'waiting' ? raw : 'idle'

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

const byStatus = (a: OpenSession, b: OpenSession) =>
  ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name)


const openUrl = async ($: EngineInterface, url: string) => {
  if ((await $.env.get('OS')) === 'Windows_NT') {
    await $.process.run(['cmd', '/c', 'start', '', url])
    return
  }
  const { exitCode } = await $.process.run(['open', url]).catch(() => ({ exitCode: 1 }))
  if (exitCode !== 0) await $.process.run(['xdg-open', url])
}

// The desktop surface has no clipboard path for mods yet, so a refused copy falls back to the OS one.
const copyText = async ($: EngineInterface, text: string, surface: RenderSurface) => {
  const copied = await $.ui.copy({ text, surface }).catch(() => ({ isCopied: false }))
  if (copied.isCopied) return true
  const commands =
    (await $.env.get('OS')) === 'Windows_NT'
      ? [['clip']]
      : [['pbcopy'], ['wl-copy'], ['xclip', '-selection', 'clipboard']]
  for (const argv of commands) {
    const { exitCode } = await $.process
      .run(argv, { stdin: text, timeoutMs: 5000 })
      .catch(() => ({ exitCode: 1 }))
    if (exitCode === 0) return true
  }
  return false
}

const copyName = async ($: EngineInterface, one: OpenSession, surface: RenderSurface) => {
  const isCopied = await copyText($, one.name, surface)
  $.ui.toast(isCopied ? `Copiado: ${one.name}` : `No se pudo copiar ${one.name}.`)
}

// Desktop sessions open through the app's own claude:// link; terminal sessions only when herdr hosts them.
const goToSession = async ($: EngineInterface, one: OpenSession) => {
  try {
    if (one.remoteId) {
      await openUrl($, `claude://code/${encodeURIComponent(one.remoteId)}`)
      return
    }
    if (one.hostSessionId) {
      await openUrl($, `claude://code/continue?session=${encodeURIComponent(one.hostSessionId)}`)
      return
    }
    const { exitCode, stdout } = await $.process.run(['herdr', 'agent', 'list'], { timeoutMs: 5000 })
    const agents: Array<{ pane_id: string; agent_session?: { value?: string } }> =
      exitCode === 0 ? JSON.parse(stdout).result.agents : []
    const pane = agents.find(agent => agent.agent_session?.value === one.sessionId)?.pane_id
    if (pane) {
      await $.process.run(['herdr', 'agent', 'focus', pane], { timeoutMs: 5000 })
      $.ui.toast(`${one.name} enfocada en herdr.`)
      return
    }
  } catch {
    // Neither the app link nor herdr answered: fall through to the toast.
  }
  $.ui.toast(`No se puede abrir ${one.name} desde aquí.`)
}

// The agent list carries no model; the spawn answers it, so it is kept here by agent id.
const agentModels = new Map<string, string>()
let agentStatuses = new Map<string, string>()

const refreshSubagents = async ($: EngineInterface) => {
  const list = await $.agent.list().catch(() => [])
  const rows: SubagentRow[] = list
    .filter(agent => agent.teammateId === undefined)
    .map(agent => {
      const model = agentModels.get(agent.id)
      return {
        id: agent.id,
        label: agent.description || agent.type,
        type: agent.type,
        status: agent.status,
        ...(model !== undefined && { model }),
      }
    })
  for (const row of rows) {
    const before = agentStatuses.get(row.id)
    if (before === undefined || before === row.status) continue
    if (row.status === 'waiting') $.ui.toast(`Subagente "${row.label}" te espera`)
    if (ACTIVE_AGENT.has(before) && !ACTIVE_AGENT.has(row.status)) {
      $.ui.toast(`Subagente "${row.label}" ${AGENT_LOOK[row.status]?.label ?? row.status}`)
    }
  }
  agentStatuses = new Map(rows.map(row => [row.id, row.status]))
  const active = rows.filter(row => ACTIVE_AGENT.has(row.status))
  const finished = rows.filter(row => !ACTIVE_AGENT.has(row.status)).slice(-MAX_FINISHED_AGENTS)
  await update($, subagents, () => [...active, ...finished])
}

export const register: Register = on => {
  let previous = new Map<string, SessionStatus>()
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId && spawned.model) agentModels.set(spawned.agentId, shortModel(spawned.model))
    await refreshSubagents($)

    return spawned
  })

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'sesiones',
      description: 'Abre el panel de sesiones de Claude abiertas en tus PCs',
    })
    void $.ui.open({ id: PANE, title: 'Sesiones' })

    const measured = await $.session.usage()
    await update($, usage, () => toUsageView(measured.context, measured.rateLimits))

    const isWindows = (await $.env.get('OS')) === 'Windows_NT'
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
    const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
    // Claude Code writes one <pid>.json per running session here; a crashed one leaves its file behind.
    const sessionsDir = `${configDir}/sessions`
    const selfId = await $.session.id()
    const host = await $.process
      .run(['hostname'], { timeoutMs: 5000 })
      .then(({ stdout }) => stdout.trim())
      .catch(() => '')
      .then(name => name.replace(/\.local$/, '') || 'esta PC')

    let local: OpenSession[] = []
    let remote: OpenSession[] = []
    let note: string | undefined

    // Session id → the title last found in its transcript and when it was looked for.
    const titles = new Map<string, { title?: string; checkedAt: number }>()
    // Transcripts sit in a folder named after the cwd with every non-alphanumeric character as `-`.
    const transcriptOf = (one: OpenSession) =>
      `${configDir}/projects/${one.cwd.replace(/[^A-Za-z0-9]/g, '-')}/${one.sessionId}.jsonl`
    const TITLE_PATTERN = '"(customTitle|aiTitle)":"[^"]*"'

    const readTitle = async (path: string) => {
      const argv = isWindows
        ? [
            'powershell',
            '-NoProfile',
            '-Command',
            `Select-String -Path '${path.replace(/'/g, "''")}' -Pattern '${TITLE_PATTERN}' -AllMatches | ForEach-Object { $_.Matches.Value }`,
          ]
        : ['grep', '-oE', TITLE_PATTERN, path]
      const { stdout } = await $.process.run(argv, { timeoutMs: 10_000 })
      const found = stdout.split(/\r?\n/).filter(Boolean)
      // A `/rename` (customTitle) wins over the generated title (aiTitle).
      const pick = found.filter(line => line.startsWith('"customTitle"')).pop() ?? found.pop()
      if (pick === undefined) return undefined
      const parsed: Record<string, string> = JSON.parse(`{${pick}}`)
      return Object.values(parsed)[0] || undefined
    }

    let isRefreshingTitles = false
    const refreshTitles = async () => {
      if (isRefreshingTitles) return
      isRefreshingTitles = true
      try {
        const now = await $.clock.now()
        // A desktop session's name already is its title.
        for (const one of local.filter(one => one.hostSessionId === undefined)) {
          const known = titles.get(one.sessionId)
          if (known !== undefined && now - known.checkedAt < TITLE_REFRESH_MS) continue
          const title = await readTitle(transcriptOf(one)).catch(() => known?.title)
          titles.set(one.sessionId, { ...(title !== undefined && { title }), checkedAt: now })
        }
      } finally {
        isRefreshingTitles = false
      }
    }

    // Every session running this mod sees the same change; a marker file lets one of them play it.
    const soundMarker = `${configDir}/open-sessions-sound.json`
    const playOnce = async (eventKey: string, asset: string) => {
      const last = await $.fs.read(soundMarker).catch(() => '')
      if (last === eventKey) return
      await $.fs.write(soundMarker, eventKey)
      await $.audio.play({ asset }).catch(() => undefined)
    }

    const publish = async () => {
      const all = [...local, ...remote]
      const finished: string[] = []
      const resumed: string[] = []
      for (const one of all) {
        const before = previous.get(sessionKey(one))
        if (one.isSelf || before === undefined || before === one.status) continue
        const where = `${one.name} (${baseName(one.cwd)}, ${one.host})`
        const eventKey = `${sessionKey(one)}:${one.status}:${one.since ?? ''}`
        if (one.status === 'waiting') {
          $.ui.toast(`${where} te espera`)
          void playOnce(eventKey, SOUND_WAITING)
        }
        if (before === 'busy' && one.status === 'idle') {
          $.ui.toast(`${where} terminó`)
          void playOnce(eventKey, SOUND_FINISHED)
          finished.push(sessionKey(one))
        }
        if (one.status === 'busy') resumed.push(sessionKey(one))
      }
      previous = new Map(all.map(one => [sessionKey(one), one.status]))
      const alive = new Set(all.map(sessionKey))
      await update($, unseen, marks => {
        const kept = Object.keys(marks).filter(key => alive.has(key) && !resumed.includes(key))
        return Object.fromEntries([...kept, ...finished].map(key => [key, true]))
      })
      const shown: SessionsView = { host, sessions: all, ...(note !== undefined && { note }) }
      await update($, view, () => shown)
    }

    const isAlive = async (pid: number) => {
      try {
        if (isWindows) {
          const { stdout } = await $.process.run(['tasklist', '/FI', `PID eq ${pid}`, '/NH'], {
            timeoutMs: 5000,
          })
          return stdout.includes(String(pid))
        }
        const { exitCode } = await $.process.run(['kill', '-0', String(pid)], { timeoutMs: 2000 })
        return exitCode === 0
      } catch {
        return true
      }
    }

    let isPollingLocal = false
    const pollLocal = async () => {
      if (isPollingLocal) return
      isPollingLocal = true
      try {
        const entries = await $.fs.list(sessionsDir).catch(() => [])
        const found: OpenSession[] = []
        for (const entry of entries) {
          if (entry.kind !== 'file' || !/^\d+\.json$/.test(entry.name)) continue
          try {
            const raw = JSON.parse(await $.fs.read(`${sessionsDir}/${entry.name}`))
            if (!(await isAlive(raw.pid))) continue
            found.push({
              sessionId: String(raw.sessionId),
              name: String(raw.name ?? baseName(raw.cwd ?? '')),
              cwd: String(raw.cwd ?? ''),
              status: toStatus(raw.status),
              ...(typeof raw.waitingFor === 'string' && { waitingFor: raw.waitingFor }),
              ...(typeof raw.statusUpdatedAt === 'number' && { since: raw.statusUpdatedAt }),
              ...(titles.get(String(raw.sessionId))?.title !== undefined && {
                title: titles.get(String(raw.sessionId))?.title,
              }),
              entrypoint: String(raw.entrypoint ?? ''),
              ...(typeof raw.hostSessionId === 'string' && { hostSessionId: raw.hostSessionId }),
              host,
              isSelf: raw.sessionId === selfId,
            })
          } catch {
            // A file mid-write or already removed: the next poll reads it.
          }
        }
        local = found.sort(byStatus)
        await publish()
        await refreshSubagents($)
        void refreshTitles()
      } finally {
        isPollingLocal = false
      }
    }

    type RemoteSession = {
      id: string
      title?: string
      status: string
      connection_status: string
      environment_kind: string
      worker_status?: string
      external_metadata?: {
        current_branches?: Record<string, string>
        post_turn_summary?: { needs_action?: string }
      }
    }

    const toRemoteStatus = (one: RemoteSession): SessionStatus => {
      if (one.external_metadata?.post_turn_summary?.needs_action) return 'waiting'
      if (one.worker_status === 'requires_action') return 'waiting'
      return one.worker_status === undefined || one.worker_status === 'idle' ? 'idle' : 'busy'
    }

    let remoteFailures = 0
    let isPollingRemote = false
    const pollRemote = async () => {
      if (isPollingRemote) return
      isPollingRemote = true
      try {
        const auth = await $.session.authorize()
        // Signed in with an API key or a third-party provider: no account sessions to list.
        if (auth === null || auth.kind !== 'bearer') return
        // The account API wants the organization; the person's own config holds it.
        const config = JSON.parse(await $.fs.read(`${home}/.claude.json`))
        const organization: unknown = config?.oauthAccount?.organizationUuid
        const response = await $.http.fetch(SESSIONS_URL, {
          auth: auth.handle,
          headers: {
            'anthropic-version': '2023-06-01',
            'anthropic-beta': SESSIONS_BETA,
            ...(typeof organization === 'string' && { 'x-organization-uuid': organization }),
          },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const listed: { data?: RemoteSession[] } = JSON.parse(response.text)
        // This PC's sessions are listed too when they have Remote Control on: drop those by title.
        const localNames = new Set(local.flatMap(one => [one.name, one.title].filter(Boolean)))
        remote = (listed.data ?? [])
          .filter(one => one.environment_kind === 'bridge' && one.status === 'active')
          .filter(one => one.connection_status === 'connected')
          .filter(one => !localNames.has(one.title ?? ''))
          .map(one => {
            const repo = Object.keys(one.external_metadata?.current_branches ?? {})[0]
            const needs = one.external_metadata?.post_turn_summary?.needs_action
            return {
              sessionId: one.id,
              remoteId: one.id,
              name: one.title || one.id,
              cwd: repo ?? '',
              status: toRemoteStatus(one),
              ...(needs ? { waitingFor: needs } : {}),
              entrypoint: 'remote',
              host: REMOTE_HOST,
              isSelf: false,
            }
          })
          .sort(byStatus)
        remoteFailures = 0
        note = undefined
      } catch {
        remoteFailures += 1
        // One failed request is usually a network blip; only a streak is worth showing.
        if (remoteFailures >= 3) note = 'No se pueden leer tus sesiones con Remote Control; reintentando.'
      } finally {
        isPollingRemote = false
        await publish()
      }
    }

    await pollLocal()
    void pollRemote()
    $.clock.every(LOCAL_POLL_MS, () => void pollLocal())
    $.clock.every(REMOTE_POLL_MS, () => void pollRemote())

    return started
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsageView(e.context, e.rateLimits))

    return next(e)
  })

  on('command.run', { command: 'sesiones' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Sesiones' })

    return { text: 'Panel de sesiones abierto.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { host, sessions, note } = await read($, view)
    const { ctxPercent, window, limits } = await read($, usage)
    const agents = await read($, subagents)
    const folded = await read($, collapsed)
    const marks = await read($, unseen)
    const now = await $.clock.now()
    const hosts = [host, ...new Set(sessions.map(one => one.host).filter(name => name !== host))]
    const isUnseen = (one: OpenSession) => marks[sessionKey(one)] === true
    const toggle = (id: string) => () => void update($, collapsed, all => ({ ...all, [id]: !all[id] }))

    const header = (id: string, title: string, counts: Array<{ count: number; color: string; glyph: string }> = []) => (
      <Box key={`header:${id}`} flexDirection="row" gap={1}>
        <Box flexShrink={1}>
          <Button key={`toggle:${id}`} plain onPress={toggle(id)}>
            <Text weight="semibold" wrap="truncate-end">
              {folded[id] ? '▸' : '▾'} {title}
            </Text>
          </Button>
        </Box>
        <Box flexShrink={0}>
          <Text>
            {counts
              .filter(({ count }) => count > 0)
              .map(({ count, color, glyph }) => (
                <Text color={color}>
                  {glyph}
                  {count}{' '}
                </Text>
              ))}
          </Text>
        </Box>
      </Box>
    )

    const sessionRow = (one: OpenSession, isLocal: boolean) => {
      const canOpen = (isLocal && !one.isSelf) || one.remoteId !== undefined
      const since = formatSince(one.since, now)
      const waitingFor = one.waitingFor === undefined ? undefined : (WAITING_FOR[one.waitingFor] ?? one.waitingFor)
      const name = (
        <Text wrap="truncate-end">
          <Text color={LOOK[one.status].color}>● </Text>
          <Text bold>{one.name}</Text>
          {one.isSelf && <Text color={GREY}> (esta)</Text>}
          {isUnseen(one) && <Text color={GREEN}> ✓ terminó</Text>}
        </Text>
      )

      return (
        <Box key={`row:${sessionKey(one)}`} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Box flexShrink={1}>
              {canOpen || isUnseen(one) ? (
                <Button
                  key={`open:${sessionKey(one)}`}
                  plain
                  onPress={() =>
                    // A session seen only through its mark (no app, herdr or Remote Control link) just clears it.
                    void markSeen($, one).then(() => (canOpen ? goToSession($, one) : undefined))
                  }
                >
                  {name}
                </Button>
              ) : (
                name
              )}
            </Box>
            <Box flexShrink={0}>
              <Button
                key={`copy:${sessionKey(one)}`}
                label="⧉"
                plain
                dimColor
                onPress={press => void copyName($, one, press.surface)}
              />
            </Box>
          </Box>
          {one.title !== undefined && (
            <Text wrap="truncate-end" italic>
              {'  '}
              {one.title}
            </Text>
          )}
          <Text color={GREY} wrap="truncate-end">
            {'  '}
            {[
              baseName(one.cwd),
              waitingFor !== undefined && one.status === 'waiting'
                ? `${LOOK[one.status].label} (${waitingFor})`
                : LOOK[one.status].label,
              since,
              one.entrypoint === 'claude-desktop' ? 'app' : one.entrypoint === 'remote' ? 'remoto' : 'terminal',
            ]
              .filter(part => part !== undefined)
              .join(' · ')}
          </Text>
        </Box>
      )
    }

    const meter = (label: string, used: number | null, value: string, detail?: string) => {
      const filled =
        used === null ? 0 : Math.min(BAR_WIDTH, Math.max(0, Math.round((used * BAR_WIDTH) / 100)))
      const color = used === null ? GREY : levelColor(used)

      return (
        <Box key={`meter:${label}`} flexDirection="row" gap={1}>
          <Box width={8} flexShrink={0}>
            <Text color={GREY}>{label}</Text>
          </Box>
          <Box flexShrink={0}>
            <Text mono>
              <Text color={color}>{'▰'.repeat(filled)}</Text>
              <Text color={GREY}>{'▱'.repeat(BAR_WIDTH - filled)}</Text>
            </Text>
          </Box>
          <Box flexShrink={1}>
            <Text wrap="truncate-end">
              <Text bold color={color}>
                {value}
              </Text>
              {detail !== undefined && <Text color={GREY}> {detail}</Text>}
            </Text>
          </Box>
        </Box>
      )
    }

    const activeAgents = agents.filter(agent => ACTIVE_AGENT.has(agent.status)).length
    const shownAgents = agents.filter(agent => !folded.agents || agent.status === 'waiting')

    return (
      // Fills the pane so the subagents and usage card sit at its bottom.
      <Box flexDirection="column" justifyContent="space-between" minHeight={e.props.scroll.bodyRows}>
        <Box key="sessions" flexDirection="column" gap={1}>
          {note !== undefined && <Text color={GREY}>{note}</Text>}
          {hosts.map(name => {
            const ofHost = sessions.filter(one => one.host === name)
            const sectionId = `host:${name}`
            // Folding hides only what needs nothing: a session waiting or finished unseen always shows.
            const shown = folded[sectionId]
              ? ofHost.filter(one => one.status === 'waiting' || isUnseen(one))
              : ofHost

            return (
              <Box key={sectionId} flexDirection="column">
                {header(sectionId, name === host ? `${name} · esta PC` : name, [
                  ...(['waiting', 'busy', 'idle'] as const).map(status => ({
                    count: ofHost.filter(one => one.status === status).length,
                    color: LOOK[status].color,
                    glyph: '●',
                  })),
                  { count: ofHost.filter(isUnseen).length, color: GREEN, glyph: '✓' },
                ])}
                {!folded[sectionId] && ofHost.length === 0 && (
                  <Text color={GREY}>{'  '}Sin sesiones abiertas.</Text>
                )}
                {shown.map(one => sessionRow(one, name === host))}
              </Box>
            )
          })}
        </Box>
        <Box
          key="footer"
          flexDirection="column"
          gap={1}
          marginTop={1}
          paddingX={1}
          borderStyle="round"
          borderColor={GREY}
        >
          {agents.length > 0 && (
            <Box key="section:agents" flexDirection="column">
              {header('agents', activeAgents > 0 ? `Subagentes · ${activeAgents} activos` : 'Subagentes')}
              {shownAgents.map(agent => {
                const look = AGENT_LOOK[agent.status] ?? { label: agent.status, color: GREY }
                const isActive = ACTIVE_AGENT.has(agent.status)

                return (
                  <Box key={`agent:${agent.id}`} flexDirection="column">
                    <Text wrap="truncate-end">
                      <Text color={look.color}>● </Text>
                      <Text bold={isActive} color={isActive ? undefined : GREY}>
                        {agent.label}
                      </Text>
                    </Text>
                    <Text color={GREY} wrap="truncate-end">
                      {'  '}
                      {[agent.type, agent.model, look.label].filter(Boolean).join(' · ')}
                    </Text>
                  </Box>
                )
              })}
            </Box>
          )}
          <Box key="section:usage" flexDirection="column">
            {header('usage', 'Uso')}
            {!folded.usage &&
              meter(
                'Contexto',
                ctxPercent,
                ctxPercent === null ? '--' : `${ctxPercent}%`,
                window > 0 ? `de ${formatWindow(window)}` : undefined,
              )}
            {!folded.usage &&
              limits.map(limit => {
                const reset = formatReset(limit)

                return meter(
                  LIMIT_LABELS[limit.kind] ?? limit.kind,
                  limit.percentUsed,
                  `${Math.max(0, Math.round(100 - limit.percentUsed))}% libre`,
                  reset !== undefined ? `↺ ${reset}` : undefined,
                )
              })}
            {folded.usage && (
              <Text color={GREY} wrap="truncate-end">
                {'  '}
                {[
                  ctxPercent === null ? undefined : `ctx ${ctxPercent}%`,
                  ...limits.map(
                    limit =>
                      `${LIMIT_LABELS[limit.kind] ?? limit.kind} ${Math.max(0, Math.round(100 - limit.percentUsed))}%`,
                  ),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            )}
          </Box>
        </Box>
      </Box>
    )
  })
}
