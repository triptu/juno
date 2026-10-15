import { chatCopy, type Banner, type JunoPage } from '@juno/agent-contract'
import type { ReactNode } from 'react'
import { ArrowsOutSimple } from '@phosphor-icons/react/dist/icons/ArrowsOutSimple'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { Chip, IconButton, OptionList, OptionRow, Popover } from '@juno/ui'
import { HeaderTitleButton } from '../header/HeaderControls'
import { HeaderIslands } from '../header/HeaderIslands'
import { JunoMark } from './JunoMark'
import { TextButton } from './TextButton'

export interface JunoHeaderProps {
  readonly banner: Banner
  readonly menuOpen: boolean
  readonly onMenu: (open: boolean) => void
  readonly onOpenPage: (page: JunoPage) => void
  /** The paused chip's Resume. */
  readonly onResume: () => void
  /** `page` for the Juno tab (the chat's 720px column), `panel` for the Juno panel (its full width). Default `page`. */
  readonly column?: 'page' | 'panel'
  /** After the banner chip in the right island: the panel's Open in a tab and Close. */
  readonly actions?: ReactNode
}

const pages: ReadonlyArray<{ readonly page: JunoPage; readonly label: string }> = (['scheduled', 'remembers', 'memory', 'activity', 'connections', 'settings'] as const).map((page) => ({
  page,
  label: chatCopy.pageTitles[page],
}))

/**
 * The Juno header (inventory 12 and 12.1): the topic header's islands and
 * band over the chat. Left: the Juno title button, which opens the Juno
 * menu with the six pages. Right, only when there is something to show:
 * the one banner chip, then the panel's `actions`. The chip's action is a
 * text button: Resume on paused, Review on recovery. The owner's area is
 * `position: relative`, with the chat list under it.
 */
export function JunoHeader({ banner, menuOpen, onMenu, onOpenPage, onResume, column = 'page', actions }: JunoHeaderProps) {
  const chip = banner._tag === 'none' ? null : <BannerChip banner={banner} onResume={onResume} onOpenPage={onOpenPage} />
  return (
    <HeaderIslands
      column={column}
      data={{ 'data-juno-header': '' }}
      left={
        <Popover
          open={menuOpen}
          onClose={() => onMenu(false)}
          width="menu"
          placement="bottom-start"
          role="menu"
          label="Juno menu"
          anchor={<HeaderTitleButton title="Juno" leading={<JunoMark size={18} />} expanded={menuOpen} onOpen={() => onMenu(!menuOpen)} />}
        >
          <OptionList role="menu" label="Juno pages" focusable>
            {pages.map((entry) => (
              <OptionRow
                key={entry.page}
                id={`juno-page-${entry.page}`}
                label={entry.label}
                onSelect={() => {
                  onMenu(false)
                  onOpenPage(entry.page)
                }}
              />
            ))}
          </OptionList>
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

/** The panel's right island after the banner chip (inventory 12.1): Open in a tab, then Close. */
export function JunoPanelActions({ onOpenInTab, onClose }: { readonly onOpenInTab: () => void; readonly onClose: () => void }) {
  return (
    <>
      <IconButton icon={ArrowsOutSimple} label={chatCopy.panel.openInTab} size={28} iconSize={15} radius="full" variant="island" onClick={onOpenInTab} />
      <IconButton icon={X} label={chatCopy.panel.close} size={28} iconSize={15} radius="full" variant="island" onClick={onClose} />
    </>
  )
}

/** One chip at a time, by the precedence the container applied. Its title is the full line. */
function BannerChip({ banner, onResume, onOpenPage }: { readonly banner: Exclude<Banner, { _tag: 'none' }>; readonly onResume: () => void; readonly onOpenPage: (page: JunoPage) => void }) {
  const copy = chatCopy.banner
  const text = copy[banner._tag]
  return (
    <Chip key={banner._tag} variant="filled" size={28} title={text.line} data-banner={banner._tag}>
      {text.chip}
      {banner._tag === 'paused' ? (
        <>
          {' · '}
          <TextButton tone="muted" onClick={onResume}>
            {copy.paused.resume}
          </TextButton>
        </>
      ) : banner._tag === 'recovery' ? (
        <>
          {' · '}
          <TextButton tone="muted" onClick={() => onOpenPage('review')}>
            {copy.recovery.review}
          </TextButton>
        </>
      ) : null}
    </Chip>
  )
}
