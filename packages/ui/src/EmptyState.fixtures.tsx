import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { defineFixtures, fixture } from './fixtures/define'

export default defineFixtures(
  EmptyState,
  {
    Sidebar: {
      // Sidebar, Unread filter on, nothing unread.
      'caught-up': fixture({
        illustration: 'caught-up',
        title: "You're all caught up",
        body: 'Nothing unread right now. Older and resolved topics live in All topics.',
        action: (
          <Button variant="secondary" size="md">
            Clear filters
          </Button>
        ),
      }),
      // Sidebar, a filter or scope hides everything.
      filtered: fixture({
        illustration: 'nothing-here',
        title: 'Nothing here with these filters',
        body: 'Older and resolved topics live in All topics.',
        action: (
          <Button variant="secondary" size="md">
            Clear filters
          </Button>
        ),
      }),
      // Sidebar, nothing recent and no filter to clear.
      quiet: fixture({
        illustration: 'nothing-here',
        title: "It's quiet",
        body: 'Topics with activity in the last 7 days show up here.',
      }),
    },
    Page: {
      workspace: fixture({ variant: 'workspace', illustration: 'nothing-open', title: 'Nothing open yet', body: 'Pick a topic on the left, or press ⌘K.', padding: 'page' }),
      'for-you': fixture({
        illustration: 'caught-up',
        title: 'Nothing for you right now',
        body: 'Juno adds a card here when something needs you.',
        padding: 'page',
      }),
      table: fixture({
        illustration: 'nothing-here',
        title: 'No topics match',
        body: 'Try fewer filters.',
        padding: 'page',
        action: (
          <Button variant="secondary" size="md">
            Clear filters
          </Button>
        ),
      }),
      juno: fixture({ variant: 'workspace', illustration: 'juno', title: 'What do you need?', padding: 'page' }),
    },
    Search: {
      palette: fixture({
        illustration: 'no-results',
        title: 'No matches for "staging"',
        body: 'Try a word from the message, or a person.',
      }),
    },
    'Without illustration': {
      'no-illustration': fixture({
        title: 'No topics match',
        body: 'Try fewer filters.',
        action: (
          <Button variant="secondary" size="md">
            Clear filters
          </Button>
        ),
      }),
    },
    Interaction: {
      'action-hover': fixture(
        {
          illustration: 'caught-up',
          title: "You're all caught up",
          body: 'Nothing unread right now. Older and resolved topics live in All topics.',
          action: (
            <Button variant="secondary" size="md">
              Clear filters
            </Button>
          ),
        },
        { hover: 'button' },
      ),
    },
  },
  { width: 384 },
)
