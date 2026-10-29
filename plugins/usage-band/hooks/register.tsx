import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BandInfo } from '../types'

const info = atom({ plugin: 'usage-band', key: 'info' } as const, null)
const title = atom({ plugin: 'usage-band', key: 'title' } as const, null)
const callModels = atom({ plugin: 'usage-band', key: 'callModels' } as const, {})

// Claude Code palette: terracotta, greys, green.
const TERRA = '#d7875f'
const GREEN = '#5fd75f'
const GREY = '#8a8a8a'
const LIGHT = '#bcbcbc'

/**
 * Display name: `claude-opus-5-5[1m]` → `Opus 5.5`. Window suffix dropped.
 * Unknown shapes pass through minus any `(… context)` suffix.
 */
const shortModel = (model: string) => {
  const id = model.replace(/\[.*\]$/, '').match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/)
  if (id) {
    const [, family = '', major, minor] = id
    return `${family[0]?.toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
  }
  return model.replace(/\s*\(.*context\)\s*$/i, '')
}

/** Reads cwd, branch, user and model. Git failure means no branch, never an error. */
async function loadInfo($: EngineInterface): Promise<BandInfo> {
  const [cwd, model, user, home] = await Promise.all([
    $.session.cwd(),
    $.session.model(),
    $.env.get('USER'),
    $.env.get('HOME'),
  ])
  let branch: string | null = null
  try {
    const git = await $.process.run(['git', 'branch', '--show-current'], { cwd, timeoutMs: 3000 })
    branch = git.exitCode === 0 ? git.stdout.trim() || null : null
  } catch {}
  const dir = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd
  return { user: user ?? 'user', dir, branch, model: shortModel(model) }
}

/**
 * Latest chat title in the transcript: `/rename` (customTitle) wins over the generated one (aiTitle).
 * Null when none written yet or grep fails.
 */
async function readTitle($: EngineInterface, transcript: string): Promise<string | null> {
  try {
    const r = await $.process.run(['grep', '-oE', '"(customTitle|aiTitle)":"[^"]*"', transcript], { timeoutMs: 3000 })
    const found = r.stdout.split('\n').filter(Boolean)
    const pick = found.filter(l => l.startsWith('"customTitle"')).pop() ?? found.pop()
    return pick ? JSON.parse(`{${pick}}`)[pick.startsWith('"customTitle"') ? 'customTitle' : 'aiTitle'] ?? null : null
  } catch {
    return null
  }
}

/** Stores the title the engine reports, else the transcript's; keeps the old one when neither has any. */
async function refreshTitle($: EngineInterface, reported: string | undefined, transcript: string) {
  const fresh = reported || (await readTitle($, transcript))
  if (fresh) await update($, title, () => fresh)
}

/** Stores fresh `info`; redraws the band. */
async function refreshInfo($: EngineInterface) {
  const fresh = await loadInfo($)
  await update($, info, () => fresh)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refreshInfo($)
    return result
  })

  // Transcript path only arrives on classic events; module var resets on reload until next prompt.
  let transcript: string | null = null

  on('classic.SessionStart', async ($, e, next) => {
    transcript = e.transcript_path
    await refreshTitle($, e.session_title, e.transcript_path)
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    transcript = e.transcript_path
    await refreshTitle($, e.session_title, e.transcript_path)
    return next(e)
  })

  // Branch or model may change during a turn (git checkout, /model); generated title lands after first turn.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    await refreshInfo($)
    if (transcript) await refreshTitle($, undefined, transcript)
    return result
  })

  // Core answers the resolved model id; kept per Agent call so its transcript row can show it.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.model && e.tool_use_id) {
      const call = e.tool_use_id
      const model = shortModel(result.model)
      await update($, callModels, all => ({ ...all, [call]: model }))
    }
    return result
  }).catch(($, e, next) => next(e)) // Band failure never blocks a spawn.

  // Transcript row `Agent(desc)` becomes `Agent(desc · Sonnet 5.5)`. Unknown call: row untouched.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool !== 'Agent') return next(e)
    const model = (await read($, callModels))[e.props.tool_use_id]
    const input = e.props.input as { description?: string } | null
    if (!model || typeof input?.description !== 'string') return next(e)
    return next({ ...e, props: { ...e.props, input: { ...input, description: `${input.description} · ${model}` } } })
  })

  // Drawn under the prompt input; engine's hint line ("auto mode on", "? for shortcuts") kept below.
  // Context, 5h/7d limits and subagents live in the open-sessions pane.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const i = await read($, info)
    const t = await read($, title)
    if (!i) return next(e)
    const hint = await next(e)

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box key="usage-band" flexDirection="column">
        <Text wrap="truncate-middle">
          <Text color={TERRA} bold>@{i.user}</Text>
          <Text color={GREY}> → </Text>
          <Text color={LIGHT}>{i.dir}</Text>
          {i.branch ? <Text color={GREY}> · </Text> : null}
          {i.branch ? <Text color={GREEN}>{i.branch}</Text> : null}
          <Text color={GREY}> │ </Text>
          <Text color={LIGHT} bold>{i.model}</Text>
          {t ? <Text color={GREY}> │ </Text> : null}
          {t ? <Text color={TERRA} italic>{t}</Text> : null}
        </Text>
        {hint}
      </Box>
    )
  })
}
