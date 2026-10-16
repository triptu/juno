import { useState } from 'react'
import { Button } from './Button'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row, Stack } from './fixtures/layout'
import { TopicArt, type TopicArtSize } from './TopicArt'

/**
 * Recipes in the vocabulary, from the design study's examples
 * (`docs/design/topic-art/v2/prompts.mjs`): a database, a calendar, two
 * people and a coin stack. Invented topics, nothing from a workspace.
 */
export const recipes = {
  database: `<svg viewBox="0 0 40 40" data-hue="teal">
  <path d="M9 11 V29 A11 4.5 0 0 0 31 29 V11"/>
  <path d="M9 20 A11 4.5 0 0 0 31 20" detail="1"/>
  <ellipse cx="20" cy="11" rx="11" ry="4.5" fill="soft"/>
  <circle cx="26" cy="29" r="2" fill="accent" stroke="none" detail="1"/>
</svg>`,
  calendar: `<svg viewBox="0 0 40 40" data-hue="periwinkle">
  <rect x="7" y="10" width="26" height="23" rx="5" fill="soft"/>
  <line x1="7" y1="17" x2="33" y2="17"/>
  <line x1="13" y1="7" x2="13" y2="12"/>
  <line x1="27" y1="7" x2="27" y2="12"/>
  <circle cx="20" cy="25" r="2.2" fill="accent" stroke="none"/>
</svg>`,
  people: `<svg viewBox="0 0 40 40" data-hue="sage">
  <circle cx="15" cy="13" r="5" fill="soft"/>
  <path d="M6 33 C6 25 10 22 15 22 C20 22 24 25 24 33"/>
  <circle cx="28" cy="15" r="4" fill="soft" detail="1"/>
  <path d="M25 31 C26 26 27 24 28.5 24 C32 24 34 27 34 33" detail="1"/>
</svg>`,
  coins: `<svg viewBox="0 0 40 40" data-hue="amber">
  <g>
    <ellipse cx="18" cy="26" rx="11" ry="4.5" fill="soft"/>
    <path d="M7 26 V21 A11 4.5 0 0 1 29 21 V26"/>
    <path d="M7 21 A11 4.5 0 0 0 29 21"/>
    <path d="M7 26 A11 4.5 0 0 0 29 26" detail="1"/>
  </g>
  <polyline points="22 15 27 10 33 13" stroke-width="2.5"/>
  <circle cx="33" cy="13" r="2" fill="accent" stroke="none"/>
</svg>`,
  /** The model said the topic gave it nothing: the placeholder stays. */
  unsure: `<svg viewBox="0 0 40 40" data-hue="coral" data-confident="false">
  <circle cx="20" cy="20" r="12" fill="soft"/>
</svg>`,
} as const

const topics = {
  postgres: 't:C0ENG:1760000000.000100',
  offsite: 't:D0MAYA:1759990000.000500',
  hiring: 'm:C0HIRING',
  bill: 't:C0ENG:1759900000.000200',
  lunch: 'm:G0MAYALEO',
  alerts: 'm:C0ALERTSPROD',
} as const

const sizes: ReadonlyArray<TopicArtSize> = [40, 20, 16]

/** One topic id per hue: a drawing takes its topic's pebble hue, not the recipe's. */
const byHue = [
  't:C0ENG:1760000000.000020', // coral
  't:C0ENG:1760000000.000000', // amber
  't:C0ENG:1760000000.000013', // olive
  't:C0ENG:1760000000.000006', // sage
  't:C0ENG:1760000000.000001', // teal
  't:C0ENG:1760000000.000034', // sky
  't:C0ENG:1760000000.000017', // periwinkle
  't:C0ENG:1760000000.000015', // plum
] as const

/**
 * The placeholder until a button brings the art, so the layout-shift guard
 * (which presses every button) checks the swap, and a person can watch it.
 */
function Arrival({ topicId, recipe, size }: { readonly topicId: string; readonly recipe: string; readonly size: TopicArtSize }) {
  const [arrived, setArrived] = useState(false)
  return (
    <Row>
      <TopicArt topicId={topicId} recipe={arrived ? recipe : undefined} size={size} />
      <Button variant="secondary" size="sm" onClick={() => setArrived(true)}>
        Art arrives
      </Button>
    </Row>
  )
}

export default defineFixtures(TopicArt, {
  Art: {
    database: fixture({ topicId: topics.postgres, recipe: recipes.database, size: 40 }),
    calendar: fixture({ topicId: topics.offsite, recipe: recipes.calendar, size: 40 }),
    people: fixture({ topicId: topics.hiring, recipe: recipes.people, size: 40 }),
    coins: fixture({ topicId: topics.bill, recipe: recipes.coins, size: 40 }),
    header: fixture({ topicId: topics.postgres, recipe: recipes.database, size: 20 }),
    tab: fixture({ topicId: topics.postgres, recipe: recipes.database, size: 16 }),
  },
  Placeholder: {
    pebble: fixture({ topicId: topics.postgres, size: 40 }),
    'pebble-header': fixture({ topicId: topics.postgres, size: 20 }),
    'pebble-tab': fixture({ topicId: topics.postgres, size: 16 }),
    'not-confident': fixture({ topicId: topics.lunch, recipe: recipes.unsure, size: 40 }),
    // A stored text outside the vocabulary draws nothing but the pebble.
    'invalid-recipe': fixture({ topicId: topics.alerts, recipe: '<svg data-hue="teal"><text>x</text></svg>', size: 40 }),
  },
  Swap: {
    arrival: scene(() => <Arrival topicId={topics.postgres} recipe={recipes.database} size={40} />),
    'arrival-header': scene(() => <Arrival topicId={topics.offsite} recipe={recipes.calendar} size={20} />),
    'arrival-tab': scene(() => <Arrival topicId={topics.bill} recipe={recipes.coins} size={16} />),
  },
  Overview: {
    'all-sizes': scene(() => (
      <Stack>
        {sizes.map((size) => (
          <Row key={size}>
            <TopicArt topicId={topics.postgres} recipe={recipes.database} size={size} />
            <TopicArt topicId={topics.offsite} recipe={recipes.calendar} size={size} />
            <TopicArt topicId={topics.hiring} recipe={recipes.people} size={size} />
            <TopicArt topicId={topics.bill} recipe={recipes.coins} size={size} />
            <TopicArt topicId={topics.lunch} size={size} />
            <TopicArt topicId={topics.alerts} size={size} />
          </Row>
        ))}
      </Stack>
    )),
    // Every hue at every size, the four drawings in turn: the palette as a set (docs/design/topic-art/v3).
    'every-hue': scene(() => (
      <Stack>
        {sizes.map((size) => (
          <Row key={size}>
            {byHue.map((id, index) => (
              <TopicArt key={id} topicId={id} recipe={[recipes.database, recipes.calendar, recipes.people, recipes.coins][index % 4]} size={size} />
            ))}
          </Row>
        ))}
      </Stack>
    )),
    'pebbles-by-topic': scene(() => (
      <Row>
        {['m:C0ENG', 'm:C0PRODUCT', 'm:C0PLATFORM', 'm:C0INCIDENTS', 'm:C0DESIGNREV', 'm:C0DEPLOYS', 'm:C0SALES', 'm:C0SOCIAL', 'm:C0HIRING', 'm:C0LEADERSHIP', 't:C0ENG:1.000001', 't:C0ENG:1.000002'].map((id) => (
          <TopicArt key={id} topicId={id} size={40} />
        ))}
      </Row>
    )),
  },
})
