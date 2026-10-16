import * as stylex from '@stylexjs/stylex'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { SidebarSimple } from '@phosphor-icons/react/dist/icons/SidebarSimple'
import { useRef, type PointerEvent } from 'react'
import { menuKeys } from '@juno/contract/channels'
import { spacing } from '@juno/tokens/tokens.stylex'
import { IconButton, type PhosphorIcon } from '@juno/ui'

export interface TitlebarNavProps {
  /** Names the sidebar button "Show sidebar" instead of "Hide sidebar". */
  readonly sidebarHidden: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly onToggleSidebar: () => void
  readonly onBack: () => void
  readonly onForward: () => void
  /** A long press on Back: the tab's history that way, as a menu. */
  readonly onBackMenu?: () => void
  readonly onForwardMenu?: () => void
}

/**
 * Hide sidebar, Back and Forward (inventory 1): after the traffic lights in
 * the sidebar's bar, or at the start of the tab strip while the sidebar is
 * hidden. Back and Forward are dimmed when the active tab has nowhere to go,
 * and a long press on either lists the tab's history, as in Safari.
 */
export function TitlebarNav({ sidebarHidden, canGoBack, canGoForward, onToggleSidebar, onBack, onForward, onBackMenu, onForwardMenu }: TitlebarNavProps) {
  return (
    <div role="group" aria-label="Navigation" {...stylex.props(styles.root)}>
      <IconButton icon={SidebarSimple} label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'} shortcut={menuKeys('sidebar.toggle')} size={30} onClick={onToggleSidebar} />
      <HistoryButton icon={CaretLeft} label="Back" shortcut={menuKeys('history.back')} enabled={canGoBack} onGo={onBack} onMenu={onBackMenu} />
      <HistoryButton icon={CaretRight} label="Forward" shortcut={menuKeys('history.forward')} enabled={canGoForward} onGo={onForward} onMenu={onForwardMenu} />
    </div>
  )
}

/** How long a press on Back or Forward lasts before it opens the history menu instead. */
const LONG_PRESS_MS = 500

interface HistoryButtonProps {
  readonly icon: PhosphorIcon
  readonly label: string
  readonly shortcut: string
  readonly enabled: boolean
  readonly onGo: () => void
  readonly onMenu: (() => void) | undefined
}

/** Acts on click, not on press, so holding it can open the menu instead. */
function HistoryButton({ icon, label, shortcut, enabled, onGo, onMenu }: HistoryButtonProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const held = useRef(false)
  const cancel = () => {
    clearTimeout(timer.current)
    timer.current = undefined
  }
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    held.current = false
    if (event.button !== 0 || onMenu === undefined) return
    timer.current = setTimeout(() => {
      timer.current = undefined
      held.current = true
      onMenu()
    }, LONG_PRESS_MS)
  }
  return (
    <IconButton
      icon={icon}
      label={label}
      shortcut={shortcut}
      size={30}
      disabled={!enabled}
      onPointerDown={onPointerDown}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onClick={() => {
        if (held.current) held.current = false
        else onGo()
      }}
    />
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
    WebkitAppRegion: 'no-drag',
  },
})
