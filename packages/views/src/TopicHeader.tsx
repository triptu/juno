import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/icons/ArrowCounterClockwise'
import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { TopicDetail } from '@juno/contract'
import { ContextPill, Popover, type ContextTint, type PhosphorIcon } from '@juno/ui'
import { HeaderTitleButton, IslandButton, JunoToggle, MoreButton, type MenuAnchor } from './header/HeaderControls'
import { HeaderIslands } from './header/HeaderIslands'
import { RenameField } from './RenameField'

export interface TopicHeaderProps {
  readonly detail: TopicDetail
  /** The topic menu, from ⋯ or a right-click on the title, is showing. */
  readonly menuOpen?: boolean
  /** ⋯ or a right-click on the title asked for the topic menu (the row's menu, inventory 15.1), to open at `at`. */
  readonly onMenu: (at: MenuAnchor) => void
  /** The title's topic switcher: whether it is open, the title's toggle, and its list (a `TopicSwitcher`). Without it the title opens the menu. */
  readonly switcher?: { readonly open: boolean; readonly onOpen: (open: boolean) => void; readonly content: ReactNode }
  /** The title is a field for Rename (from the topic menu). Threads only. */
  readonly rename?: { readonly onSave: (title: string) => void; readonly onCancel: () => void }
  /** The context pill: narrow the sidebar to the channel. */
  readonly onPill?: () => void
  /** Right-click on the context pill: the channel menu (inventory 15.2), at the pointer. */
  readonly onPillMenu?: () => void
  /** Threads: Resolve or Reopen. Without it the button is not shown. */
  readonly onResolve?: () => void
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
 * title, which opens the topic switcher, hung under the left island; a
 * right-click on it opens the topic's menu. Right: Resolve or Reopen (not
 * on Main), ⋯ (the topic's menu) and Juno. The islands line up with the
 * reading column, and under 480px Resolve shows as an icon. Rename turns
 * the title into a field in place.
 */
export function TopicHeader({ detail, menuOpen = false, onMenu, switcher, rename, onPill, onPillMenu, onResolve, juno }: TopicHeaderProps) {
  const { channel } = detail
  const main = detail.kind === 'main'
  const kind = kindLabels[channel.kind]
  const pillName = `${channel.name}, ${kind.toLowerCase()}`

  const resolve =
    main || onResolve === undefined ? null : detail.resolved ? (
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
          <span
            onContextMenu={
              onPillMenu === undefined
                ? undefined
                : (event) => {
                    event.preventDefault()
                    onPillMenu()
                  }
            }
            {...stylex.props(styles.pill)}
          >
            <ContextPill
              tint={tints[channel.kind]}
              icon={kindIcons[channel.kind]}
              name={channel.name}
              kindLabel={kind}
              size={24}
              {...(onPill === undefined ? {} : { onClick: onPill, label: `${pillName}. Show in sidebar.` })}
            />
          </span>
          {rename === undefined || main ? (
            switcher === undefined ? (
              <HeaderTitleButton title={main ? 'Main' : detail.title} expanded={menuOpen} onOpen={onMenu} />
            ) : (
              <HeaderTitleButton title={main ? 'Main' : detail.title} popup="dialog" expanded={switcher.open} onOpen={() => switcher.onOpen(!switcher.open)} onMenu={onMenu} />
            )
          ) : (
            <RenameField title={detail.title} size="header" onSave={rename.onSave} onCancel={rename.onCancel} />
          )}
        </>
      }
      right={
        <>
          {resolve}
          <MoreButton expanded={menuOpen} onOpen={onMenu} />
          {junoButton}
        </>
      }
      {...(switcher === undefined
        ? {}
        : {
            wrapLeft: (island: ReactNode) => (
              <Popover open={switcher.open} onClose={() => switcher.onOpen(false)} anchor={island} placement="bottom-start" width="browse" padding="none" label="Topics in this channel" returnFocusTo='[aria-haspopup="dialog"]'>
                {switcher.content}
              </Popover>
            ),
          })}
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
