/**
 * Where focus goes when a page comes on screen (SPEC 6). A topic opened in
 * the active tab, in place or in a new tab, focuses its composer once its
 * draft has loaded, so typing can start at once. An open from the sidebar
 * list leaves focus on its row, so ↑ and ↓ go on through the list, and the
 * first character typed there moves focus to the composer. Typed before
 * that composer is ready, the keys are held and typed into it once it
 * mounts, never into the topic still on screen. A tab that shows
 * is given page focus by `Workspace` (the focus it had, or its composer).
 */

import { holdKeys, releaseKeys } from '@juno/views'

/** The topic view whose composer takes focus when it mounts. */
let composerWanted: string | undefined

/** Until when keys typed on a sidebar row wait for the next composer to mount. The hold itself ends after a second. */
let typedAheadUntil = 0
const TYPE_AHEAD_MS = 1_000

/** A tab whose page takes focus once it shows, wherever focus was: one a pointer pressed, or one an open found. */
let pageForced: string | undefined

export function wantComposerFocus(view: string): void {
  composerWanted = view
}

/**
 * Focuses the composer field of `view` if a topic open asked for it, with
 * the caret at the end of the draft. Not while focus is in another visible
 * field, where typing may have started before the topic landed (⌘K's
 * field, a search, the Juno panel).
 */
export function takeComposerFocus(view: string, field: HTMLTextAreaElement): void {
  const typedAhead = performance.now() < typedAheadUntil
  if (composerWanted !== view && !typedAhead) return
  composerWanted = undefined
  typedAheadUntil = 0
  if (!typedAhead && typingElsewhere(document.activeElement)) return
  focusPage(field)
  field.setSelectionRange(field.value.length, field.value.length)
  if (typedAhead) releaseKeys()
}

/**
 * Focuses `element` in a page just shown. An open on a mousedown can land
 * before the press moves focus to what it pressed, such as the sidebar
 * row, so focus comes back here once the press is done.
 */
export function focusPage(element: HTMLElement): void {
  element.focus({ preventScroll: true })
  setTimeout(() => {
    if (document.activeElement !== element && element.isConnected && element.checkVisibility() && !typingElsewhere(document.activeElement)) element.focus({ preventScroll: true })
  }, 0)
}

export function forcePageFocus(tabId: string): void {
  pageForced = tabId
}

export function takeForcedPageFocus(tabId: string): boolean {
  const forced = pageForced === tabId
  pageForced = undefined
  return forced
}

function typingElsewhere(element: Element | null): boolean {
  if (!(element instanceof HTMLElement) || !element.checkVisibility()) return false
  return element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement || element.isContentEditable
}

/** The composer of the page on screen, if it has one. */
export function pageComposer(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('section[aria-label="Workspace"] main [data-composer] textarea')].find((field) => field.checkVisibility())
}

/**
 * A key typed on a sidebar row. With `ready`, the composer on screen is the
 * open topic's: focus moves there and the key lands in it. Otherwise the
 * key and those after it are held until the topic's composer mounts.
 */
export function typeOnRow(ready: boolean): void {
  const composer = ready ? pageComposer() : undefined
  if (composer !== undefined) {
    composer.focus({ preventScroll: true })
    return
  }
  holdKeys()
  typedAheadUntil = performance.now() + TYPE_AHEAD_MS
}

/** A tab came on screen while keys typed on a row wait: its composer takes them, if it has one. */
export function takeTypedAhead(): boolean {
  if (performance.now() >= typedAheadUntil) return false
  const composer = pageComposer()
  if (composer === undefined) return false
  typedAheadUntil = 0
  focusPage(composer)
  releaseKeys()
  return true
}
