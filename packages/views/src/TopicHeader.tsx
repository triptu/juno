import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { TopicDetail } from '@juno/contract'
import { layout } from '@juno/tokens/tokens.stylex'
import { ContextPill, IconButton, Popover, type ContextTint } from '@juno/ui'
import { HeaderTitleButton, JunoToggle, MoreButton, type MenuAnchor } from './header/HeaderControls'
import { HeaderIslands } from './header/HeaderIslands'
import { ReaderBack, ReaderOpen, ReaderStep, WideOnly, type TopicHeaderReader } from './header/ReaderControls'
import { kindIcon } from './look'
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
  /**
   * A thread you do not follow (Notify me is Never, SPEC 5) shows Follow in
   * Resolve's place, and a click follows it with When it matters. Without
   * it such a thread shows Resolve.
   */
  readonly onFollow?: () => void
  /** Controls from features, such as the huddle control: first in the right island. The feature decides on which topics it shows. */
  readonly actions?: ReactNode
  /**
   * A 1:1 DM, once Slack has said whether the person is active (SPEC 7,
   * "Presence in a DM"): a dot takes the person icon's place in the pill,
   * green when active and hollow when away, and the pill's name and tooltip
   * say it. Shown whatever the sidebar setting.
   */
  readonly presence?: 'active' | 'away'
  /** The Juno panel's toggle. Hidden when absent (AI assist off). */
  readonly juno?: { readonly open: boolean; readonly onToggle: () => void }
  /** The topic as the Search tab's reader (SPEC 10a): Back to results, the matches' arrows, Open in new tab. */
  readonly reader?: TopicHeaderReader
}

export type { TopicHeaderReader }


const kindLabels: Record<TopicDetail['channel']['kind'], string> = {
  public: 'Public channel',
  private: 'Private channel',
  im: 'Direct message',
  mpim: 'Group DM',
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
 * right-click on it opens the topic's menu. In a 1:1 DM the pill's icon is
 * the person's presence once known. Right: features' `actions` (the
 * huddle control), then Resolve or Reopen on a thread, or Follow on a thread
 * you do not follow, as icon buttons, then Juno and ⋯ (the topic's menu)
 * last. The islands line up with the reading column. Rename turns the title
 * into a field in place.
 */
export function TopicHeader({ detail, menuOpen = false, onMenu, switcher, rename, onPill, onPillMenu, onResolve, onFollow, actions, presence, juno, reader }: TopicHeaderProps) {
  const main = detail.kind === 'main'

  // Icons alone, with the word as the tooltip and the name. Reopen is the filled check: the thread is done, and a click undoes that.
  // Filled, the disc in the island's text colour outweighs the stroked icons beside it, so it takes the muted icon colour.
  const resolve =
    !main && onFollow !== undefined && !detail.subscribed ? (
      <IconButton icon={Bell} label="Follow" size={28} iconSize={16} radius="full" variant="island" onClick={() => onFollow()} />
    ) : main || onResolve === undefined ? null : (
      <IconButton icon={CheckCircle} label={detail.resolved ? 'Reopen' : 'Resolve'} size={28} iconSize={16} radius="full" variant="island" {...(detail.resolved ? { iconWeight: 'fill' as const, iconTint: 'neutral' as const } : {})} onClick={onResolve} />
    )
  const junoButton = juno === undefined ? null : <JunoToggle pressed={juno.open} onToggle={juno.onToggle} />

  return (
    <HeaderIslands
      column="reading"
      data={{ 'data-topic-header': '' }}
      left={
        <>
          {reader?.onBack === undefined ? null : <ReaderBack onBack={reader.onBack} />}
          <PlacePill detail={detail} presence={presence} onPill={onPill} onPillMenu={onPillMenu} />
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
      {...(reader?.step === undefined ? {} : { step: <ReaderStep step={reader.step} /> })}
      right={
        <>
          {actions}
          {reader === undefined ? null : <ReaderOpen onOpen={reader.onOpenInNewTab} />}
          {reader === undefined ? resolve : <WideOnly>{resolve}</WideOnly>}
          {reader === undefined ? junoButton : <WideOnly>{junoButton}</WideOnly>}
          <MoreButton expanded={menuOpen} onOpen={onMenu} />
        </>
      }
      {...(switcher === undefined
        ? {}
        : {
            wrapLeft: (island: ReactNode) => (
              <Popover open={switcher.open} onClose={() => switcher.onOpen(false)} anchor={island} placement="bottom-start" alignTo='[aria-haspopup="dialog"]' width="browse" padding="none" label="Topics in this channel" returnFocusTo='[aria-haspopup="dialog"]'>
                {switcher.content}
              </Popover>
            ),
          })}
    />
  )
}

/**
 * The context pill: the channel's name; its kind is the tint, the icon, the
 * tooltip and the accessible name. In a 1:1 DM the icon is the person's
 * presence once known.
 */
function PlacePill({ detail, presence, onPill, onPillMenu }: Pick<TopicHeaderProps, 'detail' | 'presence' | 'onPill' | 'onPillMenu'>) {
  const { channel } = detail
  const kind = kindLabels[channel.kind]
  const dot = channel.kind === 'im' ? presence : undefined
  // "eng, public channel", "Maya and Leo, group DM", "Maya, direct message, active": only the first letter steps down, so DM stays DM.
  const pillName = `${channel.name}, ${kind.charAt(0).toLowerCase()}${kind.slice(1)}${dot === undefined ? '' : `, ${dot}`}`
  return (
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
        icon={kindIcon(channel.kind)}
        name={channel.name}
        kindLabel={kind}
        size={24}
        // A Main's title is the one word "Main": the channel's name keeps its place there.
        iconWhenNarrow={detail.kind !== 'main'}
        {...(dot === undefined ? {} : { presence: dot })}
        {...(onPill === undefined ? {} : { onClick: onPill, label: `${pillName}. Show in sidebar.` })}
      />
    </span>
  )
}

const styles = stylex.create({
  // The full name up to 160px, then an ellipsis; it gives way only once the
  // title is at its floor. Under 480px it is its icon alone (ContextPill).
  pill: {
    display: 'flex',
    flexShrink: 1,
    minWidth: 0,
    maxWidth: layout['--header-pill-max-width'],
  },
})
