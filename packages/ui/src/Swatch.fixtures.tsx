import { hueNames } from './Avatar'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row } from './fixtures/layout'
import { Swatch } from './Swatch'

const labels: Record<(typeof hueNames)[number], string> = {
  cyan: 'Cyan',
  claret: 'Claret',
  midnight: 'Midnight',
  emeraldDark: 'Dark emerald',
  plum: 'Plum',
  rose: 'Rose',
  emerald: 'Emerald',
  jordy: 'Jordy blue',
}

function All({ selected }: { readonly selected: (typeof hueNames)[number] }) {
  return (
    <Row gap="sm">
      {hueNames.map((hue) => (
        <Swatch key={hue} hue={hue} label={labels[hue]} selected={hue === selected} />
      ))}
    </Row>
  )
}

export default defineFixtures(Swatch, {
  Value: {
    default: fixture({ hue: 'claret', label: 'Claret' }),
    selected: fixture({ hue: 'claret', label: 'Claret', selected: true }),
  },
  Interaction: {
    hover: scene(() => <All selected="cyan" />, { hover: 'button:nth-of-type(2)' }),
    press: scene(() => <All selected="cyan" />, { press: 'button:nth-of-type(2)' }),
    focus: scene(() => <All selected="cyan" />, { focus: 'button:nth-of-type(2)' }),
  },
  Overview: {
    'all-hues': scene(() => <All selected="cyan" />),
    'on-surface': scene(() => <All selected="midnight" />, { surface: 'surface' }),
  },
})
