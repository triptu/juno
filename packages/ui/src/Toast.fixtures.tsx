import { defineFixtures, fixture } from './fixtures/define'
import { Toast } from './Toast'

export default defineFixtures(Toast, {
  undo: fixture({ text: 'Resolved · Postgres 16 migration plan', action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } }),
  info: fixture({ text: 'Prompt copied' }),
  long: fixture(
    { text: 'Posted in Staging bill doubled since August and a very long topic title that will not fit', action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } },
    { width: 400 },
  ),
})
