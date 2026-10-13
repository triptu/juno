import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { defineFixtures, fixture } from './fixtures/define'
import { Toast } from './Toast'

export default defineFixtures(Toast, {
  'With undo': {
    undo: fixture({ text: 'Resolved · Postgres 16 migration plan', icon: CheckCircle, action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } }),
    'marked-done': fixture({ text: 'Marked as done', action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } }),
    ignoring: fixture({ text: 'Hiding #deploys from now on', action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } }),
  },
  Plain: {
    copied: fixture({ text: 'Copied the prompt' }),
  },
  Failure: {
    'juno-error': fixture({ text: "Juno didn't answer. Give it a moment and try again." }),
    'send-failed': fixture({ text: "Couldn't send that. Your message is still in the composer.", action: { label: 'Try again', onAction: () => {} } }),
  },
  Layout: {
    long: fixture(
      { text: 'Posted in Staging bill doubled since August and a very long topic title that will not fit', action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } },
      { width: 400 },
    ),
  },
  Interaction: {
    'undo-hover': fixture({ text: 'Resolved · Postgres 16 migration plan', icon: CheckCircle, action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } }, { hover: 'button' }),
    'undo-press': fixture({ text: 'Resolved · Postgres 16 migration plan', icon: CheckCircle, action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } }, { press: 'button' }),
    'undo-focus': fixture({ text: 'Resolved · Postgres 16 migration plan', icon: CheckCircle, action: { label: 'Undo', kbd: '⌘Z', onAction: () => {} } }, { focus: 'button' }),
  },
})
