import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement, SessionRateLimit } from 'claude-code'

import { formatDuration, formatLimits, formatLimitsDetail, meterSvg } from '../hooks/format'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 10, 5, 12, 0, 0)

const at = (ms: number) => new Date(NOW + ms).toISOString()

const LIMITS: SessionRateLimit[] = [
  { kind: 'seven_day', percentUsed: 18, resetsAt: at(2 * DAY + 3 * HOUR) },
  { kind: 'five_hour', percentUsed: 42.5, resetsAt: at(2 * HOUR + 14 * MINUTE) },
]

describe('formatDuration', () => {
  test('rounds up to whole minutes under an hour', () => {
    expect(formatDuration(30_000)).toBe('1m')
    expect(formatDuration(59 * MINUTE)).toBe('59m')
  })

  test('shows hours and minutes under a day, days and hours past one', () => {
    expect(formatDuration(2 * HOUR + 14 * MINUTE)).toBe('2h 14m')
    expect(formatDuration(2 * DAY + 3 * HOUR)).toBe('2d 3h')
  })

  test('says now once the reset has passed', () => {
    expect(formatDuration(0)).toBe('now')
    expect(formatDuration(-5 * MINUTE)).toBe('now')
  })

  test('says now for a duration that is not a finite number', () => {
    expect(formatDuration(Number.NaN)).toBe('now')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('now')
  })
})

describe('formatLimits', () => {
  test('returns undefined when there is no reading', () => {
    expect(formatLimits([], NOW)).toBeUndefined()
  })

  test('puts the 5-hour window first, then the weekly one', () => {
    expect(formatLimits(LIMITS, NOW)).toBe(
      '5h ◑ 42.5% ↻ 2h 14m │ Week ◔ 18% ↻ 2d 3h',
    )
  })

  test('omits the reset when the window has none, and caps the bar at full', () => {
    const over: SessionRateLimit[] = [{ kind: 'spend_limit', percentUsed: 130 }]
    expect(formatLimits(over, NOW)).toBe('Spend ● 130%')
  })

  test('labels an unknown window by its kind', () => {
    const odd: SessionRateLimit[] = [{ kind: 'seven_day_opus', percentUsed: 5 }]
    expect(formatLimits(odd, NOW)).toBe('seven_day_opus ○ 5%')
  })

  test('does not mistake inherited object keys for known windows', () => {
    const odd: SessionRateLimit[] = [{ kind: 'toString', percentUsed: 5 }]
    expect(formatLimits(odd, NOW)).toBe('toString ○ 5%')
  })

  test('drops a stale percentage once its window has reset', () => {
    const past: SessionRateLimit[] = [
      { kind: 'five_hour', percentUsed: 91, resetsAt: at(-MINUTE) },
    ]
    expect(formatLimits(past, NOW)).toBe('5h ○ reset')
  })
})

describe('formatLimitsDetail', () => {
  test('explains when no reading exists yet', () => {
    expect(formatLimitsDetail([], NOW)).toMatch(/No usage-limit reading yet/)
  })

  test('lists each window on its own line with a wide bar', () => {
    const text = formatLimitsDetail(LIMITS, NOW)
    expect(text).toMatch(/5-hour session\s+▰{4}▱{6}\s+42\.5% used · resets in 2h 14m/)
    expect(text).toMatch(/Weekly\s+▰{2}▱{8}\s+18% used · resets in 2d 3h/)
  })
})

const engine = (
  on: On,
  statuses: (string | undefined)[],
  limits: SessionRateLimit[],
  stored: Record<string, unknown> = {},
  surfaces: readonly ('vscode' | 'terminal')[] = ['vscode'],
) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, stored)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('command.register', () => ({ value: { command: 'limits' } }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: limits },
  }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)

    return { value: undefined }
  })

  return clock
}

const BAND = {
  plugin: 'usage-limits',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 60,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const engineDraws = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return h(Text, null, 'engine') as RenderElement
  })

describe('meterSvg', () => {
  test('fills the track in proportion and never past it', () => {
    expect(meterSvg(50)).toContain('width="36"')
    expect(meterSvg(130)).toContain('width="72"')
  })

  test('shows a sliver for a small figure and nothing for zero', () => {
    expect(meterSvg(1)).toContain('width="6"')
    expect(meterSvg(0).match(/<rect/g)?.length).toBe(1)
  })

  test('warms up as the limit gets close', () => {
    expect(meterSvg(40)).toContain('#d97757')
    expect(meterSvg(80)).toContain('#e8a33d')
    expect(meterSvg(95)).toContain('#e5534b')
  })
})

describe('the band above the prompt', () => {
  for (const surface of ['vscode', 'desktop'] as const) {
    test(`draws a real bar per window on ${surface}`, async ($, on) => {
      engine(on, [], LIMITS)
      engineDraws(on)

      await $.session.start({ cwd: '/', surface, isInteractive: true })
      const ui = await $.ui.mount({ ...BAND, surface })

      const bar = await ui.find({ type: 'Svg' })
      expect(String(bar?.props.alt)).toBe('5-hour session: 42.5% used, resets in 2h 14m')
      expect(await ui.find({ type: 'Text', text: '42.5%' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '18%' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /2d 3h/ })).toBeDefined()
      await ui.unmount()
    })
  }

  test('a window past its reset says so instead of a stale figure', async ($, on) => {
    engine(on, [], [{ kind: 'five_hour', percentUsed: 91, resetsAt: at(-MINUTE) }])
    engineDraws(on)

    await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
    const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })

    expect(await ui.find({ type: 'Text', text: 'reset' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '91%' })).toBeUndefined()
    await ui.unmount()
  })

  test('leaves the terminal to the text line', async ($, on) => {
    engine(on, [], LIMITS)
    engineDraws(on)

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
    await ui.unmount()
  })

  test('draws nothing of its own without a reading or during a survey', async ($, on) => {
    engine(on, [], [])
    engineDraws(on)

    await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
    const empty = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect(await empty.find({ type: 'Svg' })).toBeUndefined()
    await empty.unmount()

    await $.session.measure({
      context: { window: 200_000 },
      rateLimits: LIMITS,
      changed: ['rateLimits'],
    })
    const survey = await $.ui.mount({
      ...BAND,
      props: { ...BAND.props, hasSurvey: true },
      surface: 'vscode',
    })
    expect(await survey.find({ type: 'Svg' })).toBeUndefined()
    await survey.unmount()
  })

  test('a terminal attached beside the editor keeps its text line', async ($, on) => {
    const statuses: (string | undefined)[] = []
    const clock = engine(on, statuses, LIMITS, {}, ['terminal', 'vscode'])
    engineDraws(on)

    await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
    const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
    await ui.find({ type: 'Svg' })
    await clock.advance(1)

    expect(statuses.at(-1)).toMatch(/^5h /)
    await ui.unmount()
  })

  test('the text line stays until the band is drawn, then gives way', async ($, on) => {
    const statuses: (string | undefined)[] = []
    const clock = engine(on, statuses, LIMITS)
    engineDraws(on)

    await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
    expect(statuses.at(-1)).toMatch(/^5h /)

    const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
    await ui.find({ type: 'Svg' })
    await clock.advance(1)
    expect(statuses.at(-1)).toBeUndefined()

    const before = statuses.length
    await $.session.measure({
      context: { window: 200_000 },
      rateLimits: LIMITS,
      changed: ['rateLimits'],
    })
    expect(statuses.length).toBe(before)
    await ui.unmount()
  })
})

describe('the mod', () => {
  test('pins the limits as a status line when the session starts', async ($, on) => {
    const statuses: (string | undefined)[] = []
    engine(on, statuses, LIMITS)

    await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

    expect(statuses.at(-1)).toMatch(/^5h .* 42\.5% .*Week .* 18%/)
  })

  test('updates the status line when a measurement reports new limits', async ($, on) => {
    const statuses: (string | undefined)[] = []
    engine(on, statuses, [])

    await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
    await $.session.measure({
      context: { window: 200_000 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 91, resetsAt: at(20 * MINUTE) }],
      changed: ['rateLimits'],
    })

    expect(statuses.at(-1)).toBe('5h ◕ 91% ↻ 20m')
  })

  test('leaves the status line alone when only the context moved', async ($, on) => {
    const statuses: (string | undefined)[] = []
    engine(on, statuses, [])

    await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
    const before = statuses.length
    await $.session.measure({
      context: { window: 200_000, percent: 40 },
      rateLimits: [],
      changed: ['context'],
    })

    expect(statuses.length).toBe(before)
  })

  test('a failing status update still passes the measurement on', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.measure', (_, e) => ({ changed: e.changed }))
    on('command.register', () => ({ value: { command: 'limits' } }))
    on('session.usage', () => {
      throw new Error('usage unavailable')
    })
    on('ui.status', () => {
      throw new Error('status unavailable')
    })
    on('ui.log', () => ({ value: undefined }))

    await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
    const result = await $.session.measure({
      context: { window: 200_000 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 10 }],
      changed: ['rateLimits'],
    })

    expect(result.changed).toEqual(['rateLimits'])
  })

  test('a new session shows the last saved reading until its first reply', async ($, on) => {
    const statuses: (string | undefined)[] = []
    engine(on, statuses, [], { lastRateLimits: LIMITS })

    await $.session.start({ cwd: '/other-project', surface: 'vscode', isInteractive: true })

    expect(statuses.at(-1)).toMatch(/^5h .* 42\.5% .*Week .* 18%/)
  })

  test('a live reading wins over the saved one', async ($, on) => {
    const statuses: (string | undefined)[] = []
    const live: SessionRateLimit[] = [{ kind: 'five_hour', percentUsed: 3 }]
    engine(on, statuses, live, { lastRateLimits: LIMITS })

    await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

    expect(statuses.at(-1)).toBe('5h ○ 3%')
  })

  test('a saved value of the wrong shape is ignored', async ($, on) => {
    const statuses: (string | undefined)[] = []
    engine(on, statuses, [], { lastRateLimits: [{ kind: 5 }] })

    await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

    expect(statuses.at(-1)).toBeUndefined()
  })

  test('a measurement is saved and read by the next session', async ($, on) => {
    const statuses: (string | undefined)[] = []
    const stored: Record<string, unknown> = {}
    engine(on, statuses, [], stored)
    const reading: SessionRateLimit[] = [{ kind: 'seven_day', percentUsed: 33 }]

    await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
    await $.session.measure({
      context: { window: 200_000 },
      rateLimits: reading,
      changed: ['rateLimits'],
    })
    await $.session.start({ cwd: '/other-project', surface: 'vscode', isInteractive: true })

    expect(statuses.at(-1)).toBe('Week ◔ 33%')
  })

  test('/limits answers with the detailed view', async ($, on) => {
    const statuses: (string | undefined)[] = []
    engine(on, statuses, LIMITS)

    await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
    const result = await $.command.run({
      command: 'limits',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })

    expect(result.text).toMatch(/5-hour session/)
    expect(result.text).toMatch(/Weekly/)
  })
})
