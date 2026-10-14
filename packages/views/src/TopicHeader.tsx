import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/icons/ArrowCounterClockwise'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { TopicDetail } from '@juno/contract'
import { ContextPill, Popover, type ContextTint, type PhosphorIcon } from '@juno/ui'
import { HeaderTitleButton, IslandButton, JunoToggle, type MenuAnchor } from './header/HeaderControls'
import { HeaderIslands } from './header/HeaderIslands'

export interface TopicHeaderProps {
  readonly detail: TopicDetail
  /** The topic menu, opened from the title, is showing. */
  readonly menuOpen?: boolean
  /** The title asked for the topic menu (the row's menu, inventory 15.1), to open at `at`. */
  readonly onMenu: (at: MenuAnchor) => void
  /** The context pill: narrow the sidebar to the channel. */
  readonly onPill?: () => void
  /** Threads: Resolve or Reopen. Without it the button is not shown. */
  readonly onResolve?: () => void
  /** Main only: the "Threads" button is pressed and its popover is open. */
  readonly threadsOpen?: boolean
  /** Main only: the "Threads" button was pressed, or the popover asked to close. */
  readonly onThreads?: (open: boolean) => void
  /** Main only: the popover's content, an `ActiveThreads`. */
  readonly threads?: ReactNode
  /** The Juno panel's toggle. Hidden when absent (AI assist off). */
  readonly juno?: { readonly open: boolean; readonly onToggle: () => void }
}

/** A one-off size: the header pill's widest (inventory 5). */
const PILL_MAX_WIDTH = '160px'

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

/**
 * The topic header (SPEC 7, inventory 5): two islands over the top of the
 * topic, with no bar. Left: the context pill (the channel's name; its kind
 * is the tint, the icon, the tooltip and the accessible name) and the
 * title, which opens the topic's menu. Right: Resolve or Reopen (Threads on
 * Main) and Juno. Everything else is in the menu. The islands line up with
 * the reading column, and under 480px Resolve shows as an icon and Threads
 * as its count.
 */
export function TopicHeader({ detail, menuOpen = false, onMenu, onPill, onResolve, threadsOpen = false, onThreads, threads, juno }: TopicHeaderProps) {
  const { channel } = detail
  const main = detail.kind === 'main'
  const kind = kindLabels[channel.kind]
  const pillName = `${channel.name}, ${kind.toLowerCase()}`

  const threadCount = detail.threadCount ?? 0
  const threadsButton = (
    <IslandButton
      icon={ChatsCircle}
      label={threadCount > 0 ? `Threads · ${threadCount}` : 'Threads'}
      narrowLabel={threadCount > 0 ? String(threadCount) : 'Threads'}
      name={threadCount > 0 ? `Threads, ${threadCount}` : 'Threads'}
      expanded={threadsOpen}
      onClick={() => onThreads?.(!threadsOpen)}
    />
  )

  const resolve = main ? (
    onThreads === undefined ? null : (
      <Popover open={threadsOpen} onClose={() => onThreads(false)} anchor={threadsButton} placement="bottom-end" width="browse" padding="none" label="Threads">
        {threads}
      </Popover>
    )
  ) : onResolve === undefined ? null : detail.resolved ? (
    <IslandButton icon={ArrowCounterClockwise} label="Reopen" onClick={onResolve} />
  ) : (
    <IslandButton icon={CheckCircle} label="Resolve" onClick={onResolve} />
  )
  const junoButton = juno === undefined ? null : <JunoToggle pressed={juno.open} onToggle={juno.onToggle} />

  return (
    <HeaderIslands
      column="reading"
      data={{ 'data-topic-header': '' }}
      left={
        <>
          <span {...stylex.props(styles.pill)}>
            <ContextPill
              tint={tints[channel.kind]}
              icon={kindIcons[channel.kind]}
              name={channel.name}
              kindLabel={kind}
              size={24}
              {...(onPill === undefined ? {} : { onClick: onPill, label: `${pillName}. Show in sidebar.` })}
            />
          </span>
          <HeaderTitleButton title={main ? 'Main' : detail.title} expanded={menuOpen} onOpen={onMenu} />
        </>
      }
      right={
        resolve === null && junoButton === null ? undefined : (
          <>
            {resolve}
            {junoButton}
          </>
        )
      }
    />
  )
}

const styles = stylex.create({
  // The full name up to 160px, then an ellipsis; it gives way only once the title is at its floor.
  pill: {
    display: 'flex',
    flexShrink: 1,
    minWidth: 0,
    maxWidth: PILL_MAX_WIDTH,
  },
})
