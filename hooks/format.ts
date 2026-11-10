import type { SessionRateLimit } from 'claude-code'

const MINUTE = 60_000
const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR
const LONG_BAR_CELLS = 10

type WindowLabel = { short: string; long: string; order: number }

const WINDOWS: Readonly<Record<string, WindowLabel>> = {
  five_hour: { short: '5h', long: '5-hour session', order: 0 },
  seven_day: { short: 'Week', long: 'Weekly', order: 1 },
  spend_limit: { short: 'Spend', long: 'Spend limit', order: 2 },
}

const UNKNOWN_ORDER = 99

const labelOf = (kind: string): WindowLabel =>
  (Object.hasOwn(WINDOWS, kind) ? WINDOWS[kind] : undefined) ??
  { short: kind, long: kind, order: UNKNOWN_ORDER }

/** Time left until a reset, coarse: `14m`, `2h 14m`, `2d 3h`, or `now`. */
export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return 'now'

  const minutes = Math.ceil(ms / MINUTE)
  const days = Math.floor(minutes / MINUTES_PER_DAY)
  const hours = Math.floor((minutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR)
  const rest = minutes % MINUTES_PER_HOUR

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${rest}m`

  return `${rest}m`
}

/** How many of a text bar's cells are filled: at least one for any use, none at zero. */
const filledCells = (percent: number, cells: number): number =>
  percent > 0 ? Math.min(cells, Math.max(1, Math.round((percent / 100) * cells))) : 0

/** A bar in plain text, for the status line and /limits, which take no colors. */
const bar = (percent: number, cells: number): string => {
  const filled = filledCells(percent, cells)

  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

/** The chime's state, as the band and the line under the prompt show it. */
export const bellFor = (isMuted: boolean): string => (isMuted ? '\u{1F515}' : '\u{1F514}')

/** `2h 14m` as `2h14m`, so both windows fit on the status line. */
const compact = (reset: string) => reset.replaceAll(' ', '')

const msUntilReset = (limit: SessionRateLimit, now: number): number | undefined => {
  if (limit.resetsAt === undefined) return undefined

  const at = Date.parse(limit.resetsAt)

  return Number.isNaN(at) ? undefined : at - now
}

const resetIn = (limit: SessionRateLimit, now: number): string | undefined => {
  const ms = msUntilReset(limit, now)

  return ms === undefined ? undefined : formatDuration(ms)
}

/** The figure is from the last reply; past its reset it no longer holds. */
const hasReset = (limit: SessionRateLimit, now: number): boolean => {
  const ms = msUntilReset(limit, now)

  return ms !== undefined && ms <= 0
}

const STALE_LONG = 'window has reset; the new figure arrives with the next reply'

const sorted = (limits: readonly SessionRateLimit[]): SessionRateLimit[] =>
  [...limits].sort((a, b) => labelOf(a.kind).order - labelOf(b.kind).order)

const TRACK_WIDTH = 72
const TRACK_HEIGHT = 6
const MIN_FILL = 6
const WARM_PERCENT = 75
const HOT_PERCENT = 90

// The editor draws an Svg as an isolated image, so theme variables cannot reach it: these work on light and dark.
const fillColor = (percent: number): string =>
  percent >= HOT_PERCENT ? '#e5534b' : percent >= WARM_PERCENT ? '#e8a33d' : '#d97757'

/** A rounded progress bar; the track shows alone at zero. */
export const meterSvg = (percent: number): string => {
  const radius = TRACK_HEIGHT / 2
  const filled =
    percent > 0 ? Math.min(TRACK_WIDTH, Math.max(MIN_FILL, Math.round((percent / 100) * TRACK_WIDTH))) : 0
  const fill =
    filled === 0
      ? ''
      : `<rect width="${filled}" height="${TRACK_HEIGHT}" rx="${radius}" fill="${fillColor(percent)}"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TRACK_WIDTH}" height="${TRACK_HEIGHT}" viewBox="0 0 ${TRACK_WIDTH} ${TRACK_HEIGHT}"><rect width="${TRACK_WIDTH}" height="${TRACK_HEIGHT}" rx="${radius}" fill="#8b8b8b" fill-opacity="0.3"/>${fill}</svg>`
}

export type Meter = {
  key: string
  label: string
  percent: number
  /** Time left, `done` once the window has reset, undefined when unknown. */
  reset: string | undefined
  isHot: boolean
  alt: string
}

/** The windows as the band draws them, 5-hour first. */
export const toMeters = (limits: readonly SessionRateLimit[], now: number): Meter[] =>
  sorted(limits).map(limit => {
    const { short, long } = labelOf(limit.kind)

    if (hasReset(limit, now)) {
      return { key: limit.kind, label: short, percent: 0, reset: 'done', isHot: false, alt: `${long}: window has reset` }
    }

    const reset = resetIn(limit, now)
    const tail = reset === undefined ? '' : `, resets in ${reset}`

    return {
      key: limit.kind,
      label: short,
      percent: limit.percentUsed,
      reset,
      isHot: limit.percentUsed >= HOT_PERCENT,
      alt: `${long}: ${limit.percentUsed}% used${tail}`,
    }
  })

/** The terminal's line under the prompt, bars in plain text; undefined with no reading. */
export const formatLimits = (
  limits: readonly SessionRateLimit[],
  now: number,
): string | undefined => {
  if (limits.length === 0) return undefined

  return sorted(limits)
    .map(limit => {
      const label = labelOf(limit.kind).short
      if (hasReset(limit, now)) return `${label} ${bar(0, LONG_BAR_CELLS)} reset`

      const head = `${label} ${bar(limit.percentUsed, LONG_BAR_CELLS)} ${limit.percentUsed}%`
      const reset = resetIn(limit, now)

      return reset === undefined ? head : `${head} ↻ ${compact(reset)}`
    })
    .join(' │ ')
}

/** A multi-line view for the /limits command. */
export const formatLimitsDetail = (
  limits: readonly SessionRateLimit[],
  now: number,
): string => {
  if (limits.length === 0) {
    return 'No usage-limit reading yet. Limits appear after the first reply on a Claude subscription (Pro/Max); API-key sessions have none.'
  }

  const rows = sorted(limits).map(limit => {
    const label = labelOf(limit.kind).long.padEnd(16)
    if (hasReset(limit, now)) return `${label}${STALE_LONG}`

    const reset = resetIn(limit, now)
    const tail = reset === undefined ? '' : ` · resets in ${reset}`

    return `${label}${bar(limit.percentUsed, LONG_BAR_CELLS)}  ${limit.percentUsed}% used${tail}`
  })

  return ['Usage limits', ...rows, '', BAND_HINT].join('\n')
}

/** The engine's `[-]` beside the band collapses it, and a plugin can neither hide nor undo that. */
const BAND_HINT = 'Bars gone from above the prompt? Press ctrl+x, then ctrl+a, to bring them back.'
