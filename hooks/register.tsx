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
// GitHub allows 5000 API calls per hour; a read and at most a write every 15 s stays far below.
const REMOTE_POLL_MS = 15000
const HEARTBEAT_MS = 60000
// A PC that has not written for this long is off or offline: its sessions are hidden.
const STALE_MS = 120000
// Every PC finds the shared secret gist by this description.
const GIST_DESCRIPTION = 'claude-open-sessions'

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

const ACTIVE_AGENT = new Set(['pending', 'running', 'waiting'])
// Finished subagents stay listed, dim, up to this many of the most recent.
const MAX_FINISHED_AGENTS = 5
const AGENT_LOOK: Record<string, { label: string; color: string }> = {
  pending: { label: 'en cola', color: 'inactive' },
  running: { label: 'trabajando', color: 'warning' },
  waiting: { label: 'te espera', color: 'error' },
  idle: { label: 'en pausa', color: 'suggestion' },
  completed: { label: 'terminado', color: 'success' },
  failed: { label: 'falló', color: 'error' },
  killed: { label: 'detenido', color: 'inactive' },
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

const BAR_WIDTH = 14
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const LIMIT_LABELS: Record<string, string> = { five_hour: '5 horas', seven_day: '7 días' }

// Percent used: under 50 is fine, under 80 is a warning, the rest is near the limit.
const levelColor = (used: number) => (used >= 80 ? 'error' : used >= 50 ? 'warning' : 'success')

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
  waiting: { label: 'te espera', color: 'error' },
  busy: { label: 'ocupada', color: 'warning' },
  idle: { label: 'libre', color: 'suggestion' },
}

const toStatus = (raw: unknown): SessionStatus =>
  raw === 'busy' || raw === 'waiting' ? raw : 'idle'

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

const byStatus = (a: OpenSession, b: OpenSession) =>
  ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name)

type HostReport = { host: string; updatedAt: number; sessions: OpenSession[] }

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
    if (one.hostSessionId) {
      await openUrl($, `claude://code/needs-input?session=${encodeURIComponent(one.hostSessionId)}`)
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
      .then(name => name || 'esta PC')
    const hostFile = `${host.replace(/[^A-Za-z0-9._-]/g, '_')}.json`

    let local: OpenSession[] = []
    let remote: OpenSession[] = []
    let note: string | undefined

    const publish = async () => {
      const all = [...local, ...remote]
      const finished: string[] = []
      const resumed: string[] = []
      for (const one of all) {
        const before = previous.get(sessionKey(one))
        if (one.isSelf || before === undefined || before === one.status) continue
        const where = `${one.name} (${baseName(one.cwd)}, ${one.host})`
        if (one.status === 'waiting') $.ui.toast(`${where} te espera`)
        if (before === 'busy' && one.status === 'idle') {
          $.ui.toast(`${where} terminó`)
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
      } finally {
        isPollingLocal = false
      }
    }

    const gh = async (args: string[], stdin?: string) => {
      const { exitCode, stdout, stderr } = await $.process.run(['gh', ...args], {
        timeoutMs: 20000,
        ...(stdin !== undefined && { stdin }),
      })
      if (exitCode !== 0) throw new Error(stderr.trim() || `gh exited ${exitCode}`)
      return JSON.parse(stdout)
    }

    const findOrCreateGist = async (): Promise<string> => {
      const gists: Array<{ id: string; description: string | null }> = await gh([
        'api',
        'gists?per_page=100',
      ])
      const found = gists.find(gist => gist.description === GIST_DESCRIPTION)
      if (found) return found.id
      const created: { id: string } = await gh(
        ['api', '-X', 'POST', 'gists', '--input', '-'],
        JSON.stringify({
          description: GIST_DESCRIPTION,
          public: false,
          files: {
            'README.md': {
              content: 'Estado de las sesiones de Claude Code, escrito por el mod open-sessions.',
            },
          },
        }),
      )
      return created.id
    }

    let gistId: string | undefined
    let lastWritten = ''
    let lastWriteAt = 0
    let isPollingRemote = false
    const pollRemote = async () => {
      if (isPollingRemote) return
      isPollingRemote = true
      try {
        gistId ??= await findOrCreateGist()
        const now = await $.clock.now()
        const mine = local.map(({ isSelf: _, ...one }) => one)
        const mineText = JSON.stringify(mine)
        if (mineText !== lastWritten || now - lastWriteAt > HEARTBEAT_MS) {
          const report = JSON.stringify({ host, updatedAt: now, sessions: mine })
          await gh(
            ['api', '-X', 'PATCH', `gists/${gistId}`, '--input', '-'],
            JSON.stringify({ files: { [hostFile]: { content: report } } }),
          )
          lastWritten = mineText
          lastWriteAt = now
        }
        const gist: { files: Record<string, { filename: string; content?: string }> } = await gh([
          'api',
          `gists/${gistId}`,
        ])
        const others: OpenSession[] = []
        for (const file of Object.values(gist.files)) {
          if (file.filename === hostFile || !file.filename.endsWith('.json') || !file.content) continue
          try {
            const report: HostReport = JSON.parse(file.content)
            if (now - report.updatedAt > STALE_MS) continue
            others.push(
              ...report.sessions
                .map(one => ({ ...one, host: report.host, isSelf: false }))
                .sort(byStatus),
            )
          } catch {
            // Another PC's file mid-write: read it on the next poll.
          }
        }
        remote = others
        note = undefined
      } catch (error) {
        const isMissing = String(error).includes('ENOENT') || String(error).includes('not found')
        note = isMissing
          ? 'Sin GitHub CLI (gh): solo se ven las sesiones de esta PC.'
          : 'No se pudo sincronizar con GitHub; reintentando.'
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
    const hosts = [host, ...new Set(sessions.map(one => one.host).filter(name => name !== host))]

    const header = (
      id: string,
      title: string,
      summary?: string,
      counts: Array<{ count: number; color: string; glyph?: string }> = [],
    ) => (
      <Button
        key={`toggle:${id}`}
        plain
        onPress={() => void update($, collapsed, all => ({ ...all, [id]: !all[id] }))}
      >
        <Text weight="semibold">
          {folded[id] ? '▸' : '▾'} {title}
        </Text>
        {summary !== undefined && <Text dimColor> · {summary}</Text>}
        {counts
          .filter(({ count }) => count > 0)
          .map(({ count, color, glyph = '●' }) => (
            <Text color={color}>
              {' '}
              {glyph}
              {count}
            </Text>
          ))}
      </Button>
    )

    const statusCounts = (list: OpenSession[]) =>
      (['waiting', 'busy', 'idle'] as const).map(status => ({
        count: list.filter(one => one.status === status).length,
        color: LOOK[status].color,
      }))

    const meter = (label: string, used: number | null, value: string, detail?: string) => {
      const filled =
        used === null ? 0 : Math.min(BAR_WIDTH, Math.max(0, Math.round((used * BAR_WIDTH) / 100)))

      return (
        <Box key={`meter:${label}`} flexDirection="row" gap={1}>
          <Text dimColor>{label.padEnd(8)}</Text>
          <Text mono>
            <Text color={used === null ? 'inactive' : levelColor(used)}>{'▰'.repeat(filled)}</Text>
            <Text color="inactive">{'▱'.repeat(BAR_WIDTH - filled)}</Text>
          </Text>
          <Text>
            <Text bold color={used === null ? 'inactive' : levelColor(used)}>
              {value}
            </Text>
            {detail !== undefined && <Text dimColor> {detail}</Text>}
          </Text>
        </Box>
      )
    }

    const activeAgents = agents.filter(agent => ACTIVE_AGENT.has(agent.status)).length
    const fiveHour = limits.find(limit => limit.kind === 'five_hour')
    const usageSummary = [
      ctxPercent === null ? undefined : `ctx ${ctxPercent}%`,
      fiveHour === undefined ? undefined : `5h ${Math.max(0, Math.round(100 - fiveHour.percentUsed))}% libre`,
    ]
      .filter(part => part !== undefined)
      .join(' · ')

    return (
      <Box flexDirection="column" gap={1}>
        {note !== undefined && <Text dimColor>{note}</Text>}
        {hosts.map(name => {
          const ofHost = sessions.filter(one => one.host === name)
          const sectionId = `host:${name}`
          const isUnseen = (one: OpenSession) => marks[sessionKey(one)] === true
          // Folding hides only what needs nothing: a session waiting or finished unseen always shows.
          const shown = folded[sectionId]
            ? ofHost.filter(one => one.status === 'waiting' || isUnseen(one))
            : ofHost

          return (
            <Box key={sectionId} flexDirection="column">
              {header(
                sectionId,
                name === host ? `${name} (esta PC)` : name,
                ofHost.length === 0 ? 'sin sesiones' : undefined,
                [
                  ...statusCounts(ofHost),
                  { count: ofHost.filter(isUnseen).length, color: 'success', glyph: '✓' },
                ],
              )}
              {!folded[sectionId] && ofHost.length === 0 && (
                <Text dimColor>{'  '}Sin sesiones abiertas.</Text>
              )}
              {shown.map(one => (
                  <Box key={`row:${one.host}/${one.sessionId}`} flexDirection="column">
                    <Box flexDirection="row" gap={1}>
                      {name === host && !one.isSelf ? (
                        <Button
                          key={one.sessionId}
                          plain
                          onPress={() => void markSeen($, one).then(() => goToSession($, one))}
                        >
                          <Text color={LOOK[one.status].color}>● </Text>
                          <Text bold>{one.name}</Text>
                          {isUnseen(one) && <Text color="success"> ✓ terminó</Text>}
                        </Button>
                      ) : isUnseen(one) ? (
                        // Another PC's session cannot be opened from here: pressing only clears the mark.
                        <Button key={one.sessionId} plain onPress={() => void markSeen($, one)}>
                          <Text color={LOOK[one.status].color}>● </Text>
                          <Text bold>{one.name}</Text>
                          <Text color="success"> ✓ terminó</Text>
                        </Button>
                      ) : (
                        <Text>
                          <Text color={LOOK[one.status].color}>● </Text>
                          <Text bold>{one.name}</Text>
                          {one.isSelf && <Text dimColor> (esta)</Text>}
                        </Text>
                      )}
                      <Button
                        key={`copy:${one.host}/${one.sessionId}`}
                        label="copiar"
                        plain
                        dimColor
                        onPress={press => void copyName($, one, press.surface)}
                      />
                    </Box>
                    <Text dimColor>
                      {'  '}
                      {baseName(one.cwd)} · {LOOK[one.status].label}
                      {one.status === 'waiting' && one.waitingFor ? ` (${one.waitingFor})` : ''}
                      {one.entrypoint === 'claude-desktop' ? ' · app' : ' · terminal'}
                    </Text>
                  </Box>
                ))}
            </Box>
          )
        })}
        <Text dimColor>{'─'.repeat(BAR_WIDTH + 18)}</Text>
        {agents.length > 0 && (
          <Box key="section:agents" flexDirection="column">
            {header(
              'agents',
              'Subagentes',
              activeAgents > 0 ? `${activeAgents} activos` : 'ninguno activo',
            )}
            {agents
              .filter(agent => !folded.agents || agent.status === 'waiting')
              .map(agent => {
                const look = AGENT_LOOK[agent.status] ?? { label: agent.status, color: 'inactive' }
                const isActive = ACTIVE_AGENT.has(agent.status)

                return (
                  <Box key={`agent:${agent.id}`} flexDirection="column">
                    <Text wrap="truncate-end" dimColor={!isActive}>
                      <Text color={look.color}>● </Text>
                      <Text bold={isActive}>{agent.label}</Text>
                    </Text>
                    <Text dimColor wrap="truncate-end">
                      {'  '}
                      {agent.type}
                      {agent.model !== undefined ? ` · ${agent.model}` : ''} · {look.label}
                    </Text>
                  </Box>
                )
              })}
          </Box>
        )}
        <Box key="section:usage" flexDirection="column">
          {header('usage', 'Uso', folded.usage && usageSummary !== '' ? usageSummary : undefined)}
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
        </Box>
      </Box>
    )
  })
}
