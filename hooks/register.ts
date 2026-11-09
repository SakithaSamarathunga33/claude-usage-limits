import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, Timer } from 'claude-code'

import type { Reading } from '../types'
import { drawBand } from './band'
import { formatLimits, formatLimitsDetail, toMeters } from './format'

const COMMAND = 'limits'
/** Re-reads the limits each minute so the "resets in" countdown stays current. */
const REFRESH_MS = 60_000
/** The last reading, kept across sessions so a new session has figures before its first reply. */
const STORE_KEY = 'lastRateLimits'

const reading = atom({ plugin: 'usage-limits', key: 'reading' } as const, null as Reading | null)

let refresh: Timer | undefined
/** Set once a surface asks for the band: the text line stays as the fallback where none does. */
let isBandDrawn = false

async function show($: EngineInterface, limits: readonly SessionRateLimit[]) {
  const now = await $.clock.now()

  await update($, reading, () => ({ limits: [...limits], now }))
  if (!isBandDrawn) $.ui.status(formatLimits(limits, now))
}

function isRateLimit(value: unknown): value is SessionRateLimit {
  if (typeof value !== 'object' || value === null) return false

  const { kind, percentUsed, resetsAt } = value as Record<string, unknown>

  return (
    typeof kind === 'string' &&
    typeof percentUsed === 'number' &&
    (resetsAt === undefined || typeof resetsAt === 'string')
  )
}

async function savedLimits($: EngineInterface): Promise<readonly SessionRateLimit[]> {
  const saved = await $.store.get(STORE_KEY)

  return Array.isArray(saved) && saved.every(isRateLimit) ? saved : []
}

async function currentLimits($: EngineInterface): Promise<readonly SessionRateLimit[]> {
  const { rateLimits } = await $.session.usage()

  return rateLimits.length > 0 ? rateLimits : savedLimits($)
}

async function showCurrent($: EngineInterface) {
  await show($, await currentLimits($))
}

async function showAndSave($: EngineInterface, limits: readonly SessionRateLimit[]) {
  if (limits.length === 0) {
    await show($, await savedLimits($))

    return
  }

  await show($, limits)
  await $.store.set(STORE_KEY, limits)
}

async function detail($: EngineInterface) {
  return { text: formatLimitsDetail(await currentLimits($), await $.clock.now()) }
}

function logFailure($: EngineInterface, step: string, error: unknown) {
  $.ui.log(`usage-limits: ${step} failed: ${String(error)}`)
}

function refreshCurrent($: EngineInterface) {
  showCurrent($).catch((error: unknown) => logFailure($, 'refresh', error))
}

async function setUp($: EngineInterface) {
  await $.command.register({
    name: COMMAND,
    description: 'Show how much of the 5-hour and weekly usage limits is used',
  })
  await showCurrent($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    refresh?.cancel()
    refresh = $.clock.every(REFRESH_MS, () => refreshCurrent($))
    await setUp($).catch((error: unknown) => logFailure($, 'start', error))

    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await showAndSave($, e.rateLimits).catch((error: unknown) => logFailure($, 'update', error))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if ((e.surface !== 'vscode' && e.surface !== 'desktop') || e.props.hasSurvey) return next(e)

    const current = await read($, reading)
    const meters = current === null ? [] : toMeters(current.limits, await $.clock.now())

    if (meters.length === 0) return next(e)

    // The status line is shared by every surface, and a terminal cannot draw the band.
    if (!isBandDrawn && !(await $.session.surfaces()).includes('terminal')) {
      isBandDrawn = true
      $.clock.after(1, () => $.ui.status(undefined))
    }

    return drawBand($.ui.resolve(e), meters)
  })

  on('command.run', { command: COMMAND }, $ =>
    detail($).catch((error: unknown) => ({
      text: `Could not read usage limits: ${String(error)}`,
    })),
  )
}
