import type { Elements } from 'claude-code'

import { meterSvg, type Meter } from './format'

const BAR_WIDTH = 72
const BAR_HEIGHT = 6

type Drawing = Pick<Elements['vscode'], 'Box' | 'Text' | 'Svg'>

/** One row of labelled bars; wraps to two when the panel is too narrow. */
export function drawBand({ Box, Text, Svg }: Drawing, meters: readonly Meter[]) {
  return (
    <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap="md" rowGap="xs">
      {meters.map(meter => (
        <Box key={meter.key} flexDirection="row" alignItems="center" gap="sm">
          <Text size="caption" weight="medium">{meter.label}</Text>
          <Svg source={meterSvg(meter.percent)} alt={meter.alt} width={BAR_WIDTH} height={BAR_HEIGHT} />
          {meter.reset === 'done' ? (
            <Text size="caption" dimColor>reset</Text>
          ) : (
            <Text size="caption" tabular {...(meter.isHot ? { color: 'error' as const } : {})}>{`${meter.percent}%`}</Text>
          )}
          {meter.reset === undefined || meter.reset === 'done' ? (
            <></>
          ) : (
            <Text size="caption" tabular dimColor>{`↻ ${meter.reset}`}</Text>
          )}
        </Box>
      ))}
    </Box>
  )
}
