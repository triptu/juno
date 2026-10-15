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
  /** Activate was pressed and has not answered. */
  readonly activating?: boolean
  /** Why Activate was refused. */
  readonly error?: string
}

/**
 * The page behind the recovery chip's Review (SPEC 13.8): every pending
 * card, each saying it may already have happened, then "Activate Juno".
 * After a move it shows the move code to check against the old Mac; when
 * no trusted deletion record checked the backup, it says removed messages
 * may come back. Outside recovery there is nothing to activate.
 */
export function ReviewPage({ page, now, actions, onActivate, activating = false, error }: ReviewPageProps) {
  const copy = chatCopy.pages.review
  return (
    <Page>
      <PageHeader title={copy.title} subtitle={copy.body} />
      {page.backupAt === undefined && page.moveCode === undefined && page.unchecked === undefined ? null : (
        <div {...stylex.props(styles.facts)}>
          {page.backupAt === undefined ? null : (
            <Text variant="meta" tone="muted" as="p">
              Backup from {fullTime(page.backupAt)}.
            </Text>
          )}
          {page.moveCode === undefined ? null : (
            <Text variant="bodySmall" tone="default" as="p" data-move-code={page.moveCode}>
              {copy.moveCode(page.moveCode)}
            </Text>
          )}
          {page.unchecked === true ? (
            <Text variant="bodySmall" tone="subtle" as="p" sx={styles.wrap} data-review-unchecked="">
              {copy.unchecked}
            </Text>
          ) : null}
        </div>
      )}
      {page.pending.length === 0 ? (
        <Text variant="body" tone="subtle" as="p">
          Nothing was pending.
        </Text>
      ) : (
        <div role="list" aria-label="Pending actions" {...stylex.props(styles.cards)}>
          {page.pending.map((card) => (
            <div key={card.id} role="listitem" {...stylex.props(styles.card)}>
              {renderCard(card, actions, now, false)}
            </div>
          ))}
        </div>
      )}
      <div {...stylex.props(styles.activate)}>
        <Button variant="primary" size="xl" onClick={onActivate} disabled={activating || page.backupAt === undefined}>
          {copy.activate}
        </Button>
        {error === undefined ? null : (
          <Text variant="meta" tone="danger" role="alert" as="p">
            {error}
          </Text>
        )}
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
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-2'],
  },
  facts: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
  },
  wrap: {
    textWrap: 'pretty',
  },
})
