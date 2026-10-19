import { expect, it } from 'vitest'
import { measure } from './chat-cache-measure'

it('5,000 messages: cached windows reflect every event and fit the payload budget', () => {
  const run = measure('cached')
  expect(run.events).toBe(100)
  expect(run.bytes).toBeLessThan(200_000)
})
