import * as stylex from '@stylexjs/stylex'
import { chatCopy, type ReviewPage as ReviewPageModel } from '@juno/agent-contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, Page, PageHeader, Text } from '@juno/ui'
import { renderCard, type ChatActions } from '../juno-chat'
import { fullTime } from '../time'

export interface ReviewPageProps {
  readonly page: ReviewPageModel
  readonly now: number
  readonly actions: ChatActions
  /** Ends recovery. Cards still open are then expired. */
  readonly onActivate: () => void
}

/**
 * The page behind the recovery chip's Review (SPEC 13.8): every pending
 * card, each saying it may already have happened, then "Activate Juno".
 */
export function ReviewPage({ page, now, actions, onActivate }: ReviewPageProps) {
  const copy = chatCopy.pages.review
  return (
    <Page>
      <PageHeader title={copy.title} subtitle={copy.body} />
      <Text variant="meta" tone="muted" as="p">
        Backup from {fullTime(page.backupAt)}.
      </Text>
      {page.pending.length === 0 ? (
        <Text variant="body" tone="subtle" as="p">
          Nothing was pending.
        </Text>
      ) : (
        <div role="list" aria-label="Pending actions" {...stylex.props(styles.cards)}>
          {page.pending.map((card) => (
            <div key={card.id} role="listitem" {...stylex.props(styles.card)}>
              {renderCard(card, actions, now)}
            </div>
          ))}
        </div>
      )}
      <div {...stylex.props(styles.activate)}>
        <Button variant="primary" size="xl" onClick={onActivate}>
          {copy.activate}
        </Button>
      </div>
    </Page>
  )
}

const styles = stylex.create({
  cards: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
  },
  card: {
    display: 'flex',
    width: '100%',
    minWidth: 0,
  },
  activate: {
    display: 'flex',
    justifyContent: 'flex-start',
  },
})
