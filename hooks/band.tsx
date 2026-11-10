import type { Elements } from 'claude-code'

import { bellFor, meterSvg, type Meter } from './format'

const BAR_WIDTH = 72
const BAR_HEIGHT = 6

type Drawing = Pick<Elements['vscode'], 'Box' | 'Text' | 'Svg'>

/** `2h 14m` as `2h14m`: the reset is a side note, kept short so the row fits. */
const compact = (reset: string) => reset.replaceAll(' ', '')

/**
 * The editors' band: the windows side by side on the left, the chime's bell on the right.
 * Only a panel too narrow for both windows wraps the second under the first.
 *
 * The bell is an icon, not a Button: VS Code draws every Button in its theme's button
 * color. `/limits mute` and `/limits unmute` switch it.
 */
export function drawBand({ Box, Text, Svg }: Drawing, meters: readonly Meter[], isMuted: boolean) {
  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap="md">
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="lg" rowGap="xs">
        {meters.map(meter => (
          <Box key={meter.key} flexDirection="row" alignItems="center" gap="sm">
            <Text size="caption" weight="medium">{meter.label}</Text>
            <Svg source={meterSvg(meter.percent)} alt={meter.alt} width={BAR_WIDTH} height={BAR_HEIGHT} />
            {meter.reset === 'done' ? (
              <Text size="caption" dimColor>reset</Text>
            ) : (
              <Text size="caption" tabular {...(meter.isHot ? { color: 'error' as const } : {})}>{`${meter.percent}%`}</Text>
            )}
            {meter.reset !== undefined && meter.reset !== 'done' ? (
              <Text size="caption" tabular dimColor>{`↻ ${compact(meter.reset)}`}</Text>
            ) : (
              <></>
            )}
          </Box>
        ))}
      </Box>
      <Text size="caption" dimColor={isMuted}>{bellFor(isMuted)}</Text>
    </Box>
  )
}
