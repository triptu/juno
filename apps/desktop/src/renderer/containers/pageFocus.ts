/**
 * Where focus goes when a page comes on screen (SPEC 6). A topic opened in
 * the active tab, in place or in a new tab, focuses its composer once its
 * draft has loaded, so typing can start at once. A tab that shows is given
 * page focus by `Workspace` (the focus it had, or its composer).
 */

/** The topic view whose composer takes focus when it mounts. */
let composerWanted: string | undefined

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
  if (composerWanted !== view) return
  composerWanted = undefined
  if (typingElsewhere(document.activeElement)) return
  focusPage(field)
  field.setSelectionRange(field.value.length, field.value.length)
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
