import { test } from '@playwright/test'
import build from '../build'
import { fetchSpellDictionary } from '../spellDictionary'

// The electron project's build (`out/`), before any of its tests.
test('build the app', () => {
  test.setTimeout(600_000)
  build()
})

test('fetch the spelling dictionary once (Linux)', async () => {
  await fetchSpellDictionary()
})
