/**
 * Where focus goes when a page comes on screen (SPEC 6). A topic opened in
 * the active tab, in place or in a new tab, focuses its composer once its
 * draft has loaded, so typing can start at once. An open from the sidebar
 * list leaves focus on its row, so ↑ and ↓ go on through the list, and the
 * first character typed there moves focus to the composer. Typed before
 * that composer is ready, the keys are held and typed into it once it
 * mounts, never into the topic still on screen. So are characters typed
 * with focus nowhere while any other open's composer is on its way. A tab
 * that shows is given page focus by `Workspace` (the focus it had, or its
 * composer).
 */

import { holdKeys, releaseKeys } from '@juno/views'

/** The topic view whose composer takes focus when it mounts. */
let composerWanted: string | undefined

/**
 * Key and pointer presses so far. A focus asked for before the latest press
 * is dropped: the user has acted since, and may have put focus somewhere
 * (Enter on the title, then Esc, leaves it on the title). A character held
 * for the composer on its way (`holdForComposer`) is not a press.
 */
let presses = 0
let composerWantedAt = 0
let countingPresses = false

function countPress(event: Event): void {
  if (event instanceof KeyboardEvent && (event.repeat || MODIFIERS.has(event.key) || holdForComposer(event))) return
  presses += 1
}

/** Until when an open's composer is on its way: from the open, and again from when it lands. */
let composerDueUntil = 0

/**
 * A character typed with focus nowhere while a composer is on its way, as
 * after a pick in the switcher closes it: held, with the ones after it,
 * and typed into the composer once it mounts.
 */
function holdForComposer(event: KeyboardEvent): boolean {
  if (performance.now() >= composerDueUntil || event.metaKey || event.ctrlKey || [...event.key].length !== 1) return false
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused !== document.body && focused.checkVisibility()) return false
  holdKeys(event)
  typedAheadUntil = performance.now() + TYPE_AHEAD_MS
  return true
}

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn'])

function countPresses(): void {
  if (countingPresses) return
  countingPresses = true
  window.addEventListener('keydown', countPress, true)
  window.addEventListener('mousedown', countPress, true)
}

/** Until when keys typed on a sidebar row wait for the next composer to mount. The hold itself ends after a second. */
let typedAheadUntil = 0
const TYPE_AHEAD_MS = 1_000

/** A tab whose page takes focus once it shows, wherever focus was: one a pointer pressed, or one an open found. */
let pageForced: string | undefined

/** An open that will focus its composer was asked for; it lands once its topic can paint (`wantComposerFocus`). */
export function expectComposerFocus(): void {
  countPresses()
  composerDueUntil = performance.now() + TYPE_AHEAD_MS
}

export function wantComposerFocus(view: string): void {
  expectComposerFocus()
  composerWanted = view
  composerWantedAt = presses
}

/**
 * Focuses the composer field of `view` if a topic open asked for it, or
 * keys typed ahead wait for it, with the caret at the end of the draft.
 * Not while focus is in another visible field or popup, where the user may
 * have moved before the topic landed, nor, with no keys waiting, once a key
 * or the pointer was pressed since the open.
 */
export function takeComposerFocus(view: string, field: HTMLTextAreaElement): void {
  const typedAhead = performance.now() < typedAheadUntil
  if (composerWanted !== view && !typedAhead) return
  composerWanted = undefined
  composerDueUntil = 0
  typedAheadUntil = 0
  if (focusElsewhere(document.activeElement) || (!typedAhead && presses !== composerWantedAt)) return
  focusPage(field)
  field.setSelectionRange(field.value.length, field.value.length)
  if (typedAhead) releaseKeys()
}

/**
 * Focuses `element` in a page just shown. An open on a mousedown can land
 * before the press moves focus to what it pressed, such as the sidebar
 * row, so focus comes back here once the press is done, unless another
 * press came after it.
 */
export function focusPage(element: HTMLElement): void {
  countPresses()
  const at = presses
  element.focus({ preventScroll: true })
  setTimeout(() => {
    if (presses === at && document.activeElement !== element && element.isConnected && element.checkVisibility() && !focusElsewhere(document.activeElement)) element.focus({ preventScroll: true })
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

function focusElsewhere(element: Element | null): boolean {
  if (!(element instanceof HTMLElement) || !element.checkVisibility()) return false
  return element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement || element.isContentEditable || element.closest('[role="dialog"], [role="menu"], [aria-haspopup][aria-expanded="true"]') !== null
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
export function typeOnRow(ready: boolean, event: KeyboardEvent): void {
  const composer = ready ? pageComposer() : undefined
  if (composer !== undefined) {
    composer.focus({ preventScroll: true })
    return
  }
  holdKeys(event)
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
