import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { defineFixtures, fixture } from './fixtures/define'

export default defineFixtures(
  EmptyState,
  {
    sidebar: fixture({
      title: 'No unread topics',
      body: 'Your filters are hiding everything. Older and resolved topics are in All topics.',
      action: (
        <Button variant="secondary" size="md">
          Clear filters
        </Button>
      ),
    }),
    workspace: fixture({ variant: 'workspace', title: 'Nothing open', body: 'Pick a topic, or press ⌘K to find one.', padding: 'page' }),
    table: fixture({
      title: 'No topics match these filters.',
      padding: 'page',
      action: (
        <Button variant="secondary" size="md">
          Clear filters
        </Button>
      ),
    }),
  },
  { width: 384 },
)
