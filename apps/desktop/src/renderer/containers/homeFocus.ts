import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { homeFocusAtom, registry, tabsAtom } from '@juno/state'
import { afterPaint, mark } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { releaseKeys } from '@juno/views'

/** Focus is on an open menu's anchor or in its panel, outside this Home. */
function inOpenMenu(active: Element | null, field: HTMLElement | null): boolean {
  const menu = active?.closest('[aria-expanded="true"], [role="dialog"], [role="menu"]')
  return menu != null && field?.closest('[data-home]')?.contains(menu) !== true
}

/**
 * ⌘N, ⌘T and "+" ask this Home to focus its field, and with ⌘N to open its
 * destination list. Keys typed since the shortcut were held
 * (`holdKeys`); they are typed into the field or the search once it has
 * focus, which for a search not yet mounted is when it mounts.
 */
export function useFocusRequest(tabId: string, field: () => HTMLElement | null | undefined, openList: () => void, search: () => HTMLElement | null | undefined): void {
  const request = useAtomValue(homeFocusAtom)
  const active = useAtomValue(tabsAtom, (tabs) => tabs.active === tabId)
  // Taken during render, so the list is open in the same frame; the focus moves once it has painted.
  const [taken, setTaken] = useState<number | undefined>(undefined)
  const due = request?.tabId === tabId && active && request.seq !== taken ? request : undefined
  if (due !== undefined) {
    setTaken(due.seq)
    if (due.list) openList()
  }
  useEffect(() => {
    const request = registry.get(homeFocusAtom)
    if (taken === undefined || request?.seq !== taken) return
    registry.set(homeFocusAtom, undefined)
    // With the list, focus goes to its search: its own autoFocus can run while a new tab is still hidden, and
    // moving focus to the field would close the list.
    const target = request.list ? search : field
    target()?.focus()
    if (target() === document.activeElement) return releaseKeys()
    const root = field()?.closest('[data-home]')
    const onFocus = () => {
      if (target() !== document.activeElement) return
      root?.removeEventListener('focusin', onFocus)
      releaseKeys()
    }
    root?.addEventListener('focusin', onFocus)
    return () => root?.removeEventListener('focusin', onFocus)
  }, [taken, field, search])
}

/**
 * Shown again: the field takes focus, so keys typed after ⌘T or a click on Home reach it. Not from
 * an open menu elsewhere: the account menu opened while Home still loaded would close.
 */
export function useFocusOnShow(inputRef: RefObject<HTMLTextAreaElement | null>, focusField: () => void): void {
  useLayoutEffect(() => {
    if (!inOpenMenu(document.activeElement, inputRef.current)) focusField()
    afterPaint(() => {
      if (inputRef.current === document.activeElement) mark('juno.composer-ready')
    })
  }, [inputRef, focusField])
}
