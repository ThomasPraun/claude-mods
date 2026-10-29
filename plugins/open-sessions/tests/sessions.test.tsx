import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'open-sessions',
  component: 'Pane',
  requestId: 'open-sessions',
  props: {
    title: 'Sesiones',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const NOW = 1_800_000_000_000
const SESSIONS_DIR = '/Users/ana/.claude/sessions'

type FakeSession = {
  pid: number
  sessionId: string
  name: string
  cwd: string
  status: string
  statusUpdatedAt: number
  hostSessionId?: string
  entrypoint?: string
}

// The machine beneath the mod: session files, a live process for each, and what it played.
const machine = (on: On, sessions: FakeSession[]) => {
  const files = new Map(sessions.map(one => [`${SESSIONS_DIR}/${one.pid}.json`, one]))
  const toasts: string[] = []
  const sounds: string[] = []
  const runs: string[][] = []
  let marker = ''

  on('command.register', () => ({ value: { command: 'sesiones' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'self' }))
  on('session.usage', () => ({
    value: {
      context: { tokens: 230_000, window: 1_000_000, percent: 23 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 4 }],
      startedAt: NOW,
    },
  }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/Users/ana' : undefined }))
  on('agent.list', () => ({ value: [] }))
  on('fs.list', () => ({
    value: [...files.keys()].map(path => ({
      name: path.split('/').pop() ?? '',
      kind: 'file',
      size: 1,
      mtimeMs: 0,
      isLink: false,
    })),
  }))
  on('fs.read', (_$, e) => {
    const path = (e as { path: string }).path
    if (path.endsWith('open-sessions-sound.json')) return { value: marker }
    if (path.endsWith('.claude.json')) return { value: JSON.stringify({ oauthAccount: { organizationUuid: 'org-1' } }) }
    return { value: JSON.stringify(files.get(path)) }
  })
  on('fs.write', (_$, e) => {
    marker = (e as { text: string }).text
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    const argv = [...(e as { argv: string[] }).argv]
    runs.push(argv)
    const [command] = argv
    const ok = (stdout: string) => ({
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (command === 'open') return ok('')
    if (command === 'hostname') return { value: { exitCode: 0, stdout: 'MacTest\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (command === 'kill') return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (command === 'grep') return { value: { exitCode: 0, stdout: '"aiTitle":"Arreglar login"\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_$, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined }
  })
  on('audio.play', (_$, e) => {
    sounds.push(String((e as { clip: { asset?: string } }).clip.asset))
    return { value: undefined }
  })

  const setStatus = (pid: number, status: string, at: number) => {
    const path = `${SESSIONS_DIR}/${pid}.json`
    const one = files.get(path)
    if (one) files.set(path, { ...one, status, statusUpdatedAt: at })
  }

  return { toasts, sounds, runs, setStatus }
}

const orkestra: FakeSession = {
  pid: 101,
  sessionId: 'ork',
  name: 'orkestra-37',
  cwd: '/Users/ana/orkestra',
  status: 'busy',
  statusUpdatedAt: NOW - 12 * 60_000,
}

test('a session shows its title, status and how long it has been in it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  machine(on, [orkestra])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // The title is searched after the first listing and drawn from the next poll.
  await clock.advance(3000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /orkestra-37/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Arreglar login/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ocupada · 12 min/ })).toBeDefined()
  await ui.unmount()
})

test('a finished session toasts, plays once and stays shown while its PC is folded', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = machine(on, [orkestra])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  world.setStatus(101, 'idle', NOW + 1000)
  await clock.advance(3000)
  expect(world.toasts.some(text => text.includes('terminó'))).toBe(true)
  expect(world.sounds).toEqual(['sounds/finished.wav'])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'toggle:host:MacTest' })
  expect(await ui.find({ type: 'Text', text: /✓ terminó/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /orkestra-37/ })).toBeDefined()
  await ui.unmount()
})

test('folding a PC hides a session that needs nothing but keeps the count', async ($, on) => {
  mock.clock(on, { now: NOW })
  machine(on, [{ ...orkestra, status: 'idle' }])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'toggle:host:MacTest' })
  expect(await ui.find({ type: 'Text', text: /orkestra-37/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /●1/ })).toBeDefined()
  await ui.unmount()
})

test('a session that starts waiting toasts and plays the waiting sound', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = machine(on, [orkestra])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  world.setStatus(101, 'waiting', NOW + 1000)
  await clock.advance(3000)
  expect(world.toasts.some(text => text.includes('te espera'))).toBe(true)
  expect(world.sounds).toEqual(['sounds/waiting.wav'])
})

test('pressing a desktop chat opens it with the link that finds any session', async ($, on) => {
  mock.clock(on, { now: NOW })
  const world = machine(on, [
    { ...orkestra, entrypoint: 'claude-desktop', hostSessionId: 'local_abc-123', status: 'idle' },
  ])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'open:MacTest/ork' })
  expect(world.runs).toContainEqual(['open', 'claude://code/continue?session=local_abc-123'])
  await ui.unmount()
})


test('Remote Control sessions of the account show in their own group and open in the app', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = machine(on, [orkestra])
  const requests: Array<{ url: string; headers?: Record<string, string> }> = []
  on('session.authorize', () => ({ value: { handle: 'h1', kind: 'bearer' } }))
  on('http.fetch', (_$, e) => {
    const { url, init } = e as { url: string; init?: { headers?: Record<string, string> } }
    requests.push({ url, ...(init?.headers !== undefined && { headers: init.headers }) })
    const session = (id: string, title: string, extra: Record<string, unknown>) => ({
      id,
      title,
      status: 'active',
      connection_status: 'connected',
      environment_kind: 'bridge',
      worker_status: 'idle',
      external_metadata: { current_branches: { 'ana/totem': 'main' } },
      ...extra,
    })
    const data = [
      session('cse_linux', 'totemIA-Linux', { worker_status: 'running' }),
      session('cse_gone', 'Vieja', { connection_status: 'disconnected' }),
      session('cse_archived', 'Archivada', { status: 'archived' }),
      // This PC's own session, listed again because it has Remote Control on.
      session('cse_dup', 'orkestra-37', {}),
    ]
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ data }) } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  expect(requests[0]?.headers?.['x-organization-uuid']).toBe('org-1')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Remote Control/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /totem · ocupada · remoto/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Vieja|Archivada/ })).toBeUndefined()
  await ui.press({ key: 'open:Remote Control/cse_linux' })
  expect(world.runs).toContainEqual(['open', 'claude://code/cse_linux'])
  await ui.unmount()
})
