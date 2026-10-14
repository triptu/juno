import * as stylex from '@stylexjs/stylex'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import { EyeSlash } from '@phosphor-icons/react/dist/icons/EyeSlash'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import type { TopicDetail } from '@juno/contract'
import { colors, layout, radii, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { Avatar, Button, ChannelIcon, Chip, ContextPill, Icon, IconButton, Popover, Text, type ContextTint, type PhosphorIcon } from '@juno/ui'
import { channelIconFor, groupInitials, hueFor, initials } from './look'

export interface TopicHeaderProps {
  readonly detail: TopicDetail
  /** The tab is in stealth: the pill and Mark read show. */
  readonly stealth?: boolean
  /**
   * Fills the icon slot next to the title with the topic's art, at the
   * slot's size. Without it the slot shows the channel's icon or the DM
   * partner's photo, so art drops in later with no shift.
   */
  readonly art?: ReactNode
  /** Main only: the "Threads" button is pressed and its popover is open. */
  readonly threadsOpen?: boolean
  /** Main only: the "Threads" button was pressed, or the popover asked to close. */
  readonly onThreads?: (open: boolean) => void
  /** Main only: the popover's content, an `ActiveThreads`. */
  readonly threads?: ReactNode
  readonly onSubscribe: (id: string) => void
  readonly onUnsubscribe: (id: string) => void
  readonly onMarkRead: (id: string) => void
  /** Double-click to rename (not on Main). An empty title clears the manual one. */
  readonly onRename?: (id: string, title: string) => void
}

const kindLabels: Record<TopicDetail['channel']['kind'], string> = {
  public: 'Public channel',
  private: 'Private channel',
  im: 'Direct message',
  mpim: 'Group DM',
}

const kindIcons: Record<TopicDetail['channel']['kind'], PhosphorIcon> = {
  public: Hash,
  private: Lock,
  im: User,
  mpim: Users,
}

const tints: Record<TopicDetail['channel']['kind'], ContextTint> = {
  public: 'public',
  private: 'private',
  im: 'dm',
  mpim: 'dm',
}

const AI_TITLE = 'Title suggested by AI. Double-click to rename.'

/**
 * The topic header (inventory 5): the context pill, the stealth pill, the
 * actions, then the title with its icon slot. Main reads "#eng · Main" with
 * the "Threads" button; a thread shows the AI sparkle when its title came
 * from AI, and renames on double-click. Pin, Resolve and More arrive in M5,
 * which is why the right side is quiet. The background and rule run the
 * full width; the content shares the message column's width and padding,
 * so pill, title, messages and composer keep one left edge on a wide
 * window. In a narrow one the pill drops its kind, then the pill and the
 * stealth chip shrink; the actions never do.
 */
export function TopicHeader({ detail, stealth = false, art, threadsOpen = false, onThreads, threads, onSubscribe, onUnsubscribe, onMarkRead, onRename }: TopicHeaderProps) {
  const { channel } = detail
  const main = detail.kind === 'main'
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const renaming = draft !== undefined && !main && onRename !== undefined

  const commit = () => {
    if (draft !== undefined && onRename !== undefined) onRename(detail.id, draft.trim())
    setDraft(undefined)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(undefined)
    }
  }

  const threadCount = detail.threadCount ?? 0
  const threadsButton = (
    <Button variant="outline" size="lg" tone="subtle" iconStart={ChatsCircle} pressed={threadsOpen} aria-expanded={threadsOpen} onClick={() => onThreads?.(!threadsOpen)}>
      {threadCount > 0 ? `Threads · ${threadCount}` : 'Threads'}
    </Button>
  )

  return (
    <header data-topic-header="" {...stylex.props(styles.header)}>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.row)}>
          <ContextPill tint={tints[channel.kind]} icon={kindIcons[channel.kind]} name={channel.name} kindLabel={kindLabels[channel.kind]} showKind="roomy" />
          {stealth ? (
            <span {...stylex.props(styles.stealth)}>
              <Chip variant="dashed" size={26} icon={EyeSlash} shrink>
                Stealth. Not marking as read.
              </Chip>
              <Button variant="secondary" size="xs" onClick={() => onMarkRead(detail.id)}>
                Mark read
              </Button>
            </span>
          ) : null}
          <span {...stylex.props(styles.spacer)} />
          {main && onThreads !== undefined ? (
            <Popover open={threadsOpen} onClose={() => onThreads(false)} anchor={threadsButton} placement="bottom-end" width="browse" padding="none" label="Threads">
              {threads}
            </Popover>
          ) : null}
          <IconButton
            icon={Bell}
            label={detail.subscribed ? 'Subscribed. Click to unsubscribe.' : 'Unsubscribed. Click to subscribe.'}
            title={detail.subscribed ? 'Unsubscribe' : 'Subscribe'}
            size={32}
            pressed={detail.subscribed}
            onClick={() => (detail.subscribed ? onUnsubscribe(detail.id) : onSubscribe(detail.id))}
          />
        </div>
        <div {...stylex.props(styles.row, styles.titleRow)}>
          <span {...stylex.props(styles.art)}>{art ?? <TopicIcon detail={detail} />}</span>
          {renaming ? (
            <input
              type="text"
              aria-label="Topic title"
              value={draft}
              autoFocus
              onChange={(event) => setDraft(event.currentTarget.value)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={commit}
              onKeyDown={onKeyDown}
              {...stylex.props(styles.input)}
            />
          ) : main ? (
            <>
              <Text variant="topicTitle" tone="default" truncate dir="auto" sx={styles.title}>
                {channel.label} · Main
              </Text>
            </>
          ) : (
            <>
              <Text
                variant="topicTitle"
                tone="default"
                truncate
                dir="auto"
                onDoubleClick={onRename === undefined ? undefined : () => setDraft(detail.title)}
                sx={styles.title}
              >
                {detail.title}
              </Text>
              {detail.titleSource === 'ai' ? (
                <span {...stylex.props(styles.sparkle)} title={AI_TITLE}>
                  <Icon icon={Sparkle} size={16} weight="duotone" label="Title suggested by AI" />
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>
    </header>
  )
}

/** What the icon slot shows until the topic has art: the DM partner's photo, the group's initials, or the channel's icon. */
function TopicIcon({ detail }: { readonly detail: TopicDetail }) {
  const { channel } = detail
  if (channel.kind === 'im') {
    const partner = channel.partner
    const name = partner?.name ?? channel.name
    return <Avatar label={initials(name)} size={32} hue={hueFor(partner?.color ?? channel.color, partner?.id ?? channel.id)} {...(partner?.avatarUrl === undefined ? {} : { src: partner.avatarUrl })} />
  }
  if (channel.kind === 'mpim') {
    return <Avatar kind="group" label={groupInitials(channel.name)} size={32} hue={hueFor(channel.color, channel.id)} />
  }
  const icon = channelIconFor(channel.icon)
  return <ChannelIcon name={channel.name} id={channel.id} color={hueFor(channel.color, channel.id)} size={32} {...(icon === undefined ? {} : { icon })} />
}

const styles = stylex.create({
  header: {
    flexShrink: 0,
    width: '100%',
    minHeight: layout['--topic-header-height'],
    paddingBlock: spacing['--space-3-5'],
    boxSizing: 'border-box',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
    backgroundColor: colors['--background'],
    userSelect: 'none',
  },
  // The message column's width and padding (MessageList `column`). A size
  // container, so the pill can drop its kind by the header's width.
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
    width: '100%',
    maxWidth: layout['--reading-width'],
    marginInline: 'auto',
    paddingInline: spacing['--space-6'],
    boxSizing: 'border-box',
    containerType: 'inline-size',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
    minHeight: sizes['--control-32'],
  },
  titleRow: {
    gap: spacing['--space-2-5'],
  },
  // Gives way four times faster than the pill, so the channel name outlasts
  // "Stealth. Not marking as read." in a narrow header.
  stealth: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    flexShrink: 4,
    minWidth: 0,
  },
  spacer: {
    flexGrow: 1,
  },
  // The topic art slot: fixed at the avatar size, so art and the Tide
  // placeholder drop in with no shift.
  art: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--avatar-32'],
    height: sizes['--avatar-32'],
    overflow: 'hidden',
  },
  title: {
    flexShrink: 1,
    minWidth: 0,
  },
  sparkle: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  // The rename input (inventory 5): the title's own type, pulled in by its
  // padding so the text does not move when it appears.
  input: {
    flexGrow: 1,
    minWidth: 0,
    height: sizes['--control-34'],
    marginBlock: `calc(-1 * ${spacing['--space-1']})`,
    marginInlineStart: `calc(-1 * ${spacing['--space-2']})`,
    paddingInline: spacing['--space-2'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--border-strongest'],
    borderRadius: radii['--radius-lg'],
    backgroundColor: colors['--surface-default'],
    color: colors['--foreground-default'],
    fontFamily: text['--text-topic-title-family'],
    fontSize: text['--text-topic-title-size'],
    fontWeight: text['--text-topic-title-weight'],
    letterSpacing: text['--text-topic-title-tracking'],
    outline: 'none',
    cursor: 'text',
    userSelect: 'text',
  },
})
