/**
 * Fixtures for the gallery's own behaviour tests, so the switcher, the keys
 * and the index are checked against states that never change. They are
 * registered only when the page is opened with `?test-fixtures`, so they
 * never show in the normal gallery, its index or its screenshots.
 */
import { defineFixtures, fixture, type FixtureSet } from '@juno/ui'

function GalleryTestComponent({ text }: { readonly text: string }) {
  return (
    <div>
      <p>{text}</p>
      <input type="search" aria-label="Test field" />
      <input type="range" aria-label="Test slider" defaultValue={50} />
    </div>
  )
}

/** Its name contains the first one's, which keeps the tests honest about exact matching. */
function GalleryTestComponentWide({ text }: { readonly text: string }) {
  return <p>{text}</p>
}

export const testFixtures: Readonly<Record<string, FixtureSet<{ readonly text: string }>>> = {
  GalleryTestComponent: defineFixtures(GalleryTestComponent, {
    Order: {
      first: fixture({ text: 'The first state' }),
      second: fixture({ text: 'The second state' }),
      third: fixture({ text: 'The third state' }),
    },
    Extra: {
      'last one': fixture({ text: 'The last state' }),
    },
  }),
  GalleryTestComponentWide: defineFixtures(GalleryTestComponentWide, {
    Order: {
      only: fixture({ text: 'The only state' }),
    },
  }),
}
