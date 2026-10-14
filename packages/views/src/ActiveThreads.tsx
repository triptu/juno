import * as stylex from '@stylexjs/stylex'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { useId } from 'react'
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
      {threads.map((thread, index) => (
        <ThreadEntry key={thread.id} thread={thread} now={now} divider={index < threads.length - 1} onOpen={onOpen} onSubscribe={onSubscribe} onUnsubscribe={onUnsubscribe} />
      ))}
    </div>
  )
}

interface ThreadEntryProps {
  readonly thread: ThreadSummary
  readonly now: number
  readonly divider: boolean
  readonly onOpen: (id: string, event: ActivateEvent) => void
  readonly onSubscribe: (id: string) => void
  readonly onUnsubscribe: (id: string) => void
}

/**
 * One thread: a list item holding a button named by the title, described by
 * the counts and the reply line, as a sidebar row is.
 */
function ThreadEntry({ thread, now, divider, onOpen, onSubscribe, onUnsubscribe }: ThreadEntryProps) {
  const titleId = useId()
  const metaId = useId()
  const stateId = useId()
  const unread = thread.unreadCount > 0
  const replies = thread.replyCount === 1 ? '1 reply' : `${thread.replyCount} replies`
  const unreadLabel = thread.unreadExact ? `${thread.unreadCount} unread` : `${thread.unreadCount} or more unread`
  const state = [unread ? unreadLabel : undefined, thread.mentionsMe ? 'mentions you' : undefined].filter((part) => part !== undefined).join(', ')
  return (
    <div role="listitem">
      <ListRow
        minHeight={52}
        padding="table"
        divider={divider}
        onSelect={(event) => onOpen(thread.id, event)}
        aria-labelledby={titleId}
        aria-describedby={state === '' ? metaId : `${stateId} ${metaId}`}
        data-thread-id={thread.id}
        trailing={
          <IconButton
            icon={Bell}
            label="Subscribe"
            size={28}
            iconSize={16}
            pressed={thread.subscribed}
            onClick={() => (thread.subscribed ? onUnsubscribe(thread.id) : onSubscribe(thread.id))}
          />
        }
      >
        <span {...stylex.props(styles.body)}>
          <span {...stylex.props(styles.line)}>
            <Text variant="ui" weight={unread ? 'semibold' : 'medium'} tone="default" truncate tooltipWhenTruncated dir="auto" id={titleId} sx={styles.title}>
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
          <Text variant="meta" tone="muted" numeric truncate id={metaId}>
            {replies} · {relativeTime(thread.lastActivityAt, now)}
          </Text>
        </span>
        {/* The counts and the @ say their meaning only in a tooltip; the description says it in words. */}
        {state === '' ? null : (
          <span id={stateId} hidden>
            {state}.
          </span>
        )}
      </ListRow>
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
