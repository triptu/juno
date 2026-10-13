import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { defineFixtures, fixture } from './fixtures/define'
import { Toast } from './Toast'

export default defineFixtures(Toast, {
  undo: fixture({ text: 'Resolved · Postgres 16 migration plan', icon: CheckCircle, action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } }),
  'undo-hover': fixture({ text: 'Resolved · Postgres 16 migration plan', icon: CheckCircle, action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } }, { hover: 'button' }),
  'undo-press': fixture({ text: 'Resolved · Postgres 16 migration plan', icon: CheckCircle, action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } }, { press: 'button' }),
  'undo-focus': fixture({ text: 'Resolved · Postgres 16 migration plan', icon: CheckCircle, action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } }, { focus: 'button' }),
  copied: fixture({ text: 'Copied the prompt' }),
  'marked-done': fixture({ text: 'Marked as done', action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } }),
  ignoring: fixture({ text: 'Hiding #deploys from now on', action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } }),
  'juno-error': fixture({ text: "Juno didn't answer. Give it a moment and try again." }),
  'send-failed': fixture({ text: "Couldn't send that. Your message is still in the composer.", action: { label: 'Try again', onAction: () => {} } }),
  long: fixture(
    { text: 'Posted in Staging bill doubled since August and a very long topic title that will not fit', action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } },
    { width: 400 },
  ),
})
