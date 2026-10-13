import * as stylex from '@stylexjs/stylex'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import type { ThreadSummary } from '@juno/contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Chip, EmptyState, IconButton, ListRow, Text, type ActivateEvent } from '@juno/ui'
import { countLabel } from './look'
import { relativeTime } from './time'

export interface ActiveThreadsProps {
  /** Newest activity first, as `channel.threads` sends them. */
  readonly threads: ReadonlyArray<ThreadSummary>
  readonly now: number
  readonly status?: 'ready' | 'loading'
  /** Fires on mouse down; `event.metaKey` asks for a new tab. */
  readonly onOpen: (id: string, event: ActivateEvent) => void
  readonly onSubscribe: (id: string) => void
  readonly onUnsubscribe: (id: string) => void
}

/**
 * The channel's threads with recent activity, behind Main's "Threads"
 * button: title, reply count and time, the unread count and the Subscribe
 * bell. Opening one uses the current tab; subscribing adds it to the sidebar.
 */
export function ActiveThreads({ threads, now, status = 'ready', onOpen, onSubscribe, onUnsubscribe }: ActiveThreadsProps) {
  if (threads.length === 0) {
    return status === 'loading' ? (
      <div {...stylex.props(styles.quiet)}>
        <Text variant="meta" tone="muted">
          Loading threads
        </Text>
      </div>
    ) : (
      <EmptyState title="No threads lately" body="Threads with replies in the last week show up here." enter={false} />
    )
  }
  return (
    <div role="list" aria-label="Threads" {...stylex.props(styles.list)}>
      {threads.map((thread, index) => {
        const unread = thread.unreadCount > 0
        const replies = thread.replyCount === 1 ? '1 reply' : `${thread.replyCount} replies`
        const unreadLabel = thread.unreadExact ? `${thread.unreadCount} unread` : `${thread.unreadCount} or more unread`
        return (
          <ListRow
            key={thread.id}
            role="listitem"
            minHeight={52}
            padding="table"
            divider={index < threads.length - 1}
            onSelect={(event) => onOpen(thread.id, event)}
            data-thread-id={thread.id}
            trailing={
              <IconButton
                icon={Bell}
                label={thread.subscribed ? 'Subscribed. Click to unsubscribe.' : 'Unsubscribed. Click to subscribe.'}
                title={thread.subscribed ? 'Unsubscribe' : 'Subscribe'}
                size={28}
                iconSize={16}
                pressed={thread.subscribed}
                onClick={() => (thread.subscribed ? onUnsubscribe(thread.id) : onSubscribe(thread.id))}
              />
            }
          >
            <span {...stylex.props(styles.body)}>
              <span {...stylex.props(styles.line)}>
                <Text variant="ui" weight={unread ? 'semibold' : 'medium'} tone="default" truncate dir="auto" sx={styles.title}>
                  {thread.title}
                </Text>
                {thread.mentionsMe ? (
                  <Chip variant="soft" title="Mentions you">
                    @
                  </Chip>
                ) : null}
                {unread ? (
                  <Chip variant="strong" numeric title={unreadLabel}>
                    {countLabel(thread.unreadCount, thread.unreadExact)}
                  </Chip>
                ) : null}
              </span>
              <Text variant="meta" tone="muted" numeric truncate>
                {replies} · {relativeTime(thread.lastActivityAt, now)}
              </Text>
            </span>
          </ListRow>
        )
      })}
    </div>
  )
}

const styles = stylex.create({
  list: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    minWidth: 0,
  },
  line: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },
  title: {
    flexShrink: 1,
    minWidth: 0,
  },
  quiet: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: spacing['--space-8'],
    userSelect: 'none',
  },
})
