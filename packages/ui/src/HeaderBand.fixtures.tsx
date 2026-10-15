import { defineFixtures, scene } from './fixtures/define'
import { HeaderBand } from './HeaderBand'
import { Text } from './Text'

const lines = Array.from({ length: 6 }, (_, i) => `Line ${i + 1} of the list under the header fades out below the islands.`)

/** The band over a few lines of text, so the solid part and the fade show. */
function OverText() {
  return (
    <div style={{ position: 'relative', width: 480 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {lines.map((line) => (
          <Text key={line} variant="body">
            {line}
          </Text>
        ))}
      </div>
      <HeaderBand />
    </div>
  )
}

export default defineFixtures(HeaderBand, {
  Default: {
    'over-text': scene(() => <OverText />),
  },
})
