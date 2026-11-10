import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  SessionRateLimit,
  Timer,
  TurnCompleteInput,
} from 'claude-code'

import type { Reading } from '../types'
import { drawBand } from './band'
import { bellFor, formatLimits, formatLimitsDetail, toMeters } from './format'

const COMMAND = 'limits'
/** Re-reads the limits each minute so the "resets in" countdown stays current. */
const REFRESH_MS = 60_000
/** The last reading, kept across sessions so a new session has figures before its first reply. */
const STORE_KEY = 'lastRateLimits'
/** The tone played when a task finishes, relative to the plugin's directory. */
const CHIME = 'sounds/done.wav'
const NOTIFY_TITLE = 'Claude'
/** Windows shows a notification only under a registered app; PowerShell's own is on every install. */
const POWERSHELL_APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'

/** Whether the chime is muted, kept across sessions; the atom only redraws the bell. */
const MUTED_KEY = 'isChimeMuted'

const reading = atom({ plugin: 'usage', key: 'reading' } as const, null as Reading | null)
const muted = atom({ plugin: 'usage', key: 'isMuted' } as const, null as boolean | null)

/**
 * Where the band is drawn. The terminal keeps the line under the prompt: a band there gets
 * the engine's `[-]`, which hides it until ctrl+x ctrl+a, a key few people know.
 */
const BAND_SURFACES: readonly string[] = ['vscode', 'desktop']

let refresh: Timer | undefined
/** Set once a surface asks for the band: the text line stays as the fallback where none does. */
let isBandDrawn = false

async function show($: EngineInterface, limits: readonly SessionRateLimit[]) {
  const now = await $.clock.now()

  await update($, reading, () => ({ limits: [...limits], now }))
  if (isBandDrawn) return

  const line = formatLimits(limits, now)
  $.ui.status(line === undefined ? undefined : `${line} │ ${bellFor(await isChimeMuted($))}`)
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

async function showSaved($: EngineInterface) {
  await show($, await savedLimits($))
}

/** A reload keeps the reading, which can be newer than the saved one. */
async function showSavedIfEmpty($: EngineInterface) {
  if ((await read($, reading)) === null) await showSaved($)
}

async function showAndSave($: EngineInterface, limits: readonly SessionRateLimit[]) {
  if (limits.length === 0) {
    await showSaved($)

    return
  }

  await show($, limits)
  await $.store.set(STORE_KEY, limits)
}

async function detail($: EngineInterface) {
  return { text: formatLimitsDetail(await currentLimits($), await $.clock.now()) }
}

function logFailure($: EngineInterface, step: string, error: unknown) {
  $.ui.log(`usage: ${step} failed: ${String(error)}`)
}

function refreshCurrent($: EngineInterface) {
  showCurrent($).catch((error: unknown) => logFailure($, 'refresh', error))
}

/** A PowerShell single-quoted string literal. */
const psString = (text: string) => `'${text.replaceAll("'", "''")}'`

const escapeXml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** True once the script ran; false where PowerShell cannot start (not Windows) or the script failed. */
async function runPowerShell($: EngineInterface, script: string): Promise<boolean> {
  try {
    const { exitCode } = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', script])

    return exitCode === 0
  } catch {
    return false
  }
}

/** The engine has no clip player on Windows, so PowerShell plays the chime there; elsewhere the engine does. */
async function playChime($: EngineInterface) {
  const path = psString(`${$.plugin.root}/${CHIME}`)

  if (!(await runPowerShell($, `(New-Object Media.SoundPlayer ${path}).PlaySync()`))) {
    await $.audio.play({ asset: CHIME })
  }
}

/** A Windows notification, shown under PowerShell's app id; silent, as the chime is the sound. */
function windowsToastScript(title: string, text: string) {
  const xml = `<toast><visual><binding template="ToastGeneric"><text>${escapeXml(title)}</text><text>${escapeXml(text)}</text></binding></visual><audio silent="true"/></toast>`

  return [
    '$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]',
    '$x = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]::new()',
    `$x.LoadXml(${psString(xml)})`,
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${psString(POWERSHELL_APP_ID)}).Show([Windows.UI.Notifications.ToastNotification]::new($x))`,
  ].join('\n')
}

/**
 * Seen even when the window is out of focus: a Windows notification first, then the
 * terminal's own; the in-app toast only where neither exists.
 */
async function notifyDone($: EngineInterface, e: TurnCompleteInput) {
  const seconds = Math.round(e.durationMs / 1000)
  const text = e.reason === 'answer' ? `Task finished (${seconds}s)` : `Task stopped: ${e.reason}`

  if (await runPowerShell($, windowsToastScript(NOTIFY_TITLE, text))) return
  if ((await $.ui.notify(text, { title: NOTIFY_TITLE })).isSent) return
  $.ui.toast(text)
}

async function isChimeMuted($: EngineInterface) {
  return (await $.store.get(MUTED_KEY)) === true
}

async function setChimeMuted($: EngineInterface, isMuted: boolean) {
  await $.store.set(MUTED_KEY, isMuted)
  await update($, muted, () => isMuted)

  // The line under the prompt shows the bell too; redraw it with the same figures.
  const current = await read($, reading)
  if (current !== null) await show($, current.limits)

  return { text: isMuted ? 'Chime muted. Notifications still show.' : 'Chime on.' }
}

/** `/limits` alone shows the detail; `mute` and `unmute` switch the chime. */
async function runCommand($: EngineInterface, args: string) {
  const word = args.trim().toLowerCase()

  if (word === 'mute') return setChimeMuted($, true)
  if (word === 'unmute') return setChimeMuted($, false)
  if (word === '') return detail($)

  return { text: `Unknown option "${word}". Use /limits, /limits mute or /limits unmute.` }
}

async function chimeUnlessMuted($: EngineInterface) {
  if (!(await isChimeMuted($))) await playChime($)
}

function announceDone($: EngineInterface, e: TurnCompleteInput) {
  notifyDone($, e).catch((error: unknown) => logFailure($, 'notification', error))
  chimeUnlessMuted($).catch((error: unknown) => logFailure($, 'chime', error))
}

async function setUp($: EngineInterface) {
  await $.command.register({
    name: COMMAND,
    description: 'Show how much of the 5-hour and weekly usage limits is used; mute or unmute the chime',
    argumentHint: '[mute|unmute]',
  })
  await showCurrent($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The saved figures need nothing from the engine, so they don't wait for it to finish starting.
    await showSavedIfEmpty($).catch((error: unknown) => logFailure($, 'saved reading', error))

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

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    // Subagents' turns end inside the main one, and an interrupted turn has the person at the keyboard.
    if (e.agentId === undefined && !e.isAborted) announceDone($, e)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!BAND_SURFACES.includes(e.surface) || e.props.hasSurvey) return next(e)

    const current = await read($, reading)
    // The engine can draw at plugin load, before session.start has filled the reading.
    const limits = current?.limits ?? (await savedLimits($))
    const meters = toMeters(limits, await $.clock.now())

    if (meters.length === 0) return next(e)

    // The status line is shared by every surface: it stays while any attached one draws no band.
    if (!isBandDrawn && (await $.session.surfaces()).every(surface => BAND_SURFACES.includes(surface))) {
      isBandDrawn = true
      $.clock.after(1, () => $.ui.status(undefined))
    }

    const isMuted = (await read($, muted)) ?? (await isChimeMuted($))

    return drawBand($.ui.resolve(e), meters, isMuted)
  })

  on('command.run', { command: COMMAND }, ($, e) =>
    runCommand($, e.args).catch((error: unknown) => ({
      text: `Could not run /limits: ${String(error)}`,
    })),
  )
}
