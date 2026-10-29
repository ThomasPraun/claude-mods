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

type FakeSession = { pid: number; sessionId: string; name: string; cwd: string; status: string; statusUpdatedAt: number }

// The machine beneath the mod: session files, a live process for each, no gh, and what it played.
const machine = (on: On, sessions: FakeSession[]) => {
  const files = new Map(sessions.map(one => [`${SESSIONS_DIR}/${one.pid}.json`, one]))
  const toasts: string[] = []
  const sounds: string[] = []
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
    return { value: JSON.stringify(files.get(path)) }
  })
  on('fs.write', (_$, e) => {
    marker = (e as { text: string }).text
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    const [command] = (e as { argv: string[] }).argv
    if (command === 'hostname') return { value: { exitCode: 0, stdout: 'MacTest\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (command === 'kill') return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (command === 'grep') return { value: { exitCode: 0, stdout: '"aiTitle":"Arreglar login"\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 1, stdout: '', stderr: 'gh: command not found', isStdoutTruncated: false, isStderrTruncated: false } }
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

  return { toasts, sounds, setStatus }
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
