import * as stylex from '@stylexjs/stylex'
import { chatCopy, type Banner, type JunoPage } from '@juno/agent-contract'
import { menuKeys } from '../keys'
import { colors } from '@juno/tokens/tokens.stylex'
import { Fragment, type ReactNode } from 'react'
import { ArrowsOutSimple } from '@phosphor-icons/react/dist/icons/ArrowsOutSimple'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { Chip, IconButton, OptionList, OptionRow, OptionSeparator, Popover, useMenuActive } from '@juno/ui'
import { HeaderTitleButton } from '../header/HeaderControls'
import { HeaderIslands } from '../header/HeaderIslands'
import { JunoMark } from './JunoMark'
import { TextButton } from './TextButton'

/** What a Juno tab or the Juno panel shows: the chat, or one of its pages. Connections and Settings are sections of Settings. */
export type JunoView = 'chat' | Exclude<JunoPage, 'settings' | 'connections'>

/** Where the switcher can go: a Juno view, or a section of Settings. */
export type JunoTarget = JunoView | 'connections' | 'settings'

/**
 * The switcher's rows in order, a separator between groups: the chat, Juno's
 * own pages, then the Settings sections. A new Juno page is one entry here
 * and one title in `chatCopy.pageTitles`. Review is not listed: its banner
 * chip opens it, and the title names it while it shows.
 */
export const junoSwitcher: ReadonlyArray<ReadonlyArray<JunoTarget>> = [['chat'], ['scheduled', 'remembers', 'memory', 'activity'], ['connections', 'settings']]

/** A target's name, as the menu row and the title say it. */
export const junoTargetTitle = (target: JunoTarget): string => (target === 'chat' ? chatCopy.switcher.chat : chatCopy.pageTitles[target])

export interface JunoHeaderProps {
  readonly banner: Banner
  readonly menuOpen: boolean
  readonly onMenu: (open: boolean) => void
  /** The view shown under the header, named in the title and checked in the menu. Default the chat. */
  readonly current?: JunoView
  /** A row of the switcher, or the banner chip's Review. */
  readonly onOpenPage: (target: JunoTarget) => void
  /** The paused chip's Resume. */
  readonly onResume: () => void
  /** `page` for the Juno tab (the chat's 720px column), `panel` for the Juno panel (its full width). Default `page`. */
  readonly column?: 'page' | 'panel'
  /** After the banner chip in the right island: the panel's Open in a tab and Close. */
  readonly actions?: ReactNode
}

/**
 * The Juno header (inventory 12 and 12.1): the topic header's islands and
 * band over the chat or a Juno page, in the same place on each. Left: the
 * Juno title button, "Juno" over the chat and "Juno · Activity" over a
 * page, which opens the switcher: the chat and every Juno page, with a
 * check on the one shown, then Connections and Settings. Right, only when
 * there is something to show: the one banner chip, then the panel's
 * `actions`. The chip's action is a text button: Resume on paused, Review
 * on recovery. The owner's area is `position: relative`, with the chat
 * list or the page under it.
 */
export function JunoHeader({ banner, menuOpen, onMenu, current = 'chat', onOpenPage, onResume, column = 'page', actions }: JunoHeaderProps) {
  const chip = banner._tag === 'none' ? null : <BannerChip banner={banner} onResume={onResume} onOpenPage={onOpenPage} />
  const onPage = current !== 'chat'
  return (
    <HeaderIslands
      column={column}
      // "Juno" keeps its width over the chat; over a page the name and the chip share the room.
      give={onPage ? 'both' : 'right'}
      data={{ 'data-juno-header': current }}
      left={
        <Popover
          open={menuOpen}
          onClose={() => onMenu(false)}
          width="menu"
          placement="bottom-start"
          role="menu"
          label="Juno menu"
          anchor={
            <HeaderTitleButton
              title={onPage ? junoTargetTitle(current) : 'Juno'}
              leading={
                <>
                  <JunoMark />
                  {onPage ? <span {...stylex.props(styles.context)}>{'Juno · '}</span> : null}
                </>
              }
              expanded={menuOpen}
              onOpen={() => onMenu(!menuOpen)}
              // A menu button, not a heading: a Juno page's serif title is its one h1.
              heading={false}
            />
          }
        >
          <JunoMenu
            current={current}
            onOpenPage={(target) => {
              onMenu(false)
              onOpenPage(target)
            }}
          />
        </Popover>
      }
      right={
        chip === null && actions === undefined ? undefined : (
          <>
            {chip}
            {actions}
          </>
        )
      }
    />
  )
}

const rowId = (target: JunoTarget) => `juno-page-${target}`

/** The switcher's rows, with one active row for the pointer and the keyboard, and a check on the view shown. */
function JunoMenu({ current, onOpenPage }: { readonly current: JunoView; readonly onOpenPage: (target: JunoTarget) => void }) {
  const targets = junoSwitcher.flat()
  const menu = useMenuActive(targets.map(rowId), (id) => onOpenPage(id.slice('juno-page-'.length) as JunoTarget))
  return (
    <OptionList role="menu" label={chatCopy.switcher.label} {...menu.list}>
      {junoSwitcher.map((group, index) => (
        <Fragment key={group[0]}>
          {index === 0 ? null : <OptionSeparator />}
          {group.map((target) => (
            <OptionRow key={target} {...menu.row(rowId(target))} label={junoTargetTitle(target)} selected={target === current} onSelect={() => onOpenPage(target)} />
          ))}
        </Fragment>
      ))}
    </OptionList>
  )
}

/** The panel's right island after the banner chip (inventory 12.1): Open in a tab, then Close. */
export function JunoPanelActions({ onOpenInTab, onClose }: { readonly onOpenInTab: () => void; readonly onClose: () => void }) {
  return (
    <>
      <IconButton icon={ArrowsOutSimple} label={chatCopy.panel.openInTab} size={28} iconSize={15} radius="full" variant="island" onClick={onOpenInTab} />
      <IconButton icon={X} label={chatCopy.panel.close} shortcut={menuKeys('juno.toggle')} size={28} iconSize={15} radius="full" variant="island" onClick={onClose} />
    </>
  )
}

/**
 * One chip at a time, by the precedence the container applied. Its title is
 * the full line. In a narrow header the chip shrinks: the line takes the
 * ellipsis, and its action (Resume, Review) stays whole.
 */
function BannerChip({ banner, onResume, onOpenPage }: { readonly banner: Exclude<Banner, { _tag: 'none' }>; readonly onResume: () => void; readonly onOpenPage: (target: JunoTarget) => void }) {
  const copy = chatCopy.banner
  const text = copy[banner._tag]
  const action =
    banner._tag === 'paused' ? (
      <TextButton tone="muted" onClick={onResume}>
        {copy.paused.resume}
      </TextButton>
    ) : banner._tag === 'recovery' ? (
      <TextButton tone="muted" onClick={() => onOpenPage('review')}>
        {copy.recovery.review}
      </TextButton>
    ) : null
  return (
    <Chip key={banner._tag} variant="filled" size={28} title={text.line} data-banner={banner._tag} shrink>
      <span {...stylex.props(styles.chipLine)}>
        <span {...stylex.props(styles.chipText)}>{text.chip}</span>
        {action === null ? null : (
          <span {...stylex.props(styles.chipAction)}>
            {' · '}
            {action}
          </span>
        )}
      </span>
    </Chip>
  )
}

/** The header's own width at the minimum window (336), under the narrowest panel (360). */
const MINIMUM = '@container (width < 352px)'

const styles = stylex.create({
  // "Juno · " before a page's name: the context, quieter than the name. At the minimum window it goes, so the name keeps its room.
  context: {
    display: { default: 'inline', [MINIMUM]: 'none' },
    flexShrink: 0,
    // Subtle, not muted: muted is 4.4:1 on the trigger's hover and open fill (tokens.md 1.7).
    color: colors['--foreground-subtle'],
    whiteSpace: 'pre',
  },
  chipLine: {
    display: 'flex',
    alignItems: 'baseline',
    minWidth: 0,
  },
  chipText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  },
  // Spaced as before the split: " · Review", kept whole.
  chipAction: {
    flexShrink: 0,
    whiteSpace: 'pre',
  },
})
