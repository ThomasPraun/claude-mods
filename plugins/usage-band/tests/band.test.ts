import { describe, expect, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

const HINT = {
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: 'auto mode on' },
} as const

// The session the band describes: its folder, model, user and git branch.
const answerSession = (on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/Users/ana/proyecto' }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('env.get', (_$, e) => ({ value: e.name === 'USER' ? 'ana' : '/Users/ana' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
}

describe('usage-band', () => {
  test('draws the session line under the prompt and keeps the engine hint', async ($, on) => {
    on('ui.render', ($$, e) => {
      const { Text } = $$.ui.resolve(e)
      return h(Text, { key: 'engine-hint' }, 'auto mode on') as RenderElement
    })
    answerSession(on)
    await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'usage-band', surface, ...HINT })
      expect(await ui.find({ key: 'usage-band' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^auto mode on$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^@ana$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^~\/proyecto$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Opus 5\.5$/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('shows the chat title the engine reports', async ($, on) => {
    on('classic.UserPromptSubmit', () => ({}))
    on('ui.render', ($$, e) => {
      const { Text } = $$.ui.resolve(e)
      return h(Text, { key: 'engine-hint' }, 'auto mode on') as RenderElement
    })
    answerSession(on)
    await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
    await $.classic.UserPromptSubmit({ prompt: 'hola', session_title: 'Mi chat' })
    const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...HINT })
    expect(await ui.find({ type: 'Text', text: /^Mi chat$/ })).toBeDefined()
    await ui.unmount()
  })

  test('adds the model to the Agent transcript row', async ($, on) => {
    on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'a2' }))
    on('ui.render', ($$, e) => {
      const { Text } = $$.ui.resolve(e)
      const input = (e.props as { input?: { description?: string } }).input
      return h(Text, { key: 'row' }, `Agent(${input?.description ?? ''})`) as RenderElement
    })
    await $.agent.spawn({ prompt: 'busca', description: 'Buscar docs', subagentType: 'Explore', tool_use_id: 'tu1' } as never)
    const row = (id: string) => ({
      component: 'ToolUse',
      props: { tool_use_id: id, tool: 'Agent', input: { description: 'Buscar docs' }, isRunning: false, isErrored: false, isInterrupted: false },
    }) as const
    const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...row('tu1') })
    expect(await ui.find({ type: 'Text', text: /^Agent\(Buscar docs · Haiku 4\.5\)$/ })).toBeDefined()
    await ui.unmount()
    const other = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...row('tu-unknown') })
    expect(await other.find({ type: 'Text', text: /^Agent\(Buscar docs\)$/ })).toBeDefined()
    await other.unmount()
  })
})
