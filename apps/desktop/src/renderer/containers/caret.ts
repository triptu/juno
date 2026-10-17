/**
 * Clears the caret a text field leaves behind once focus has moved to
 * something that is not a text field (performance.md 8, "stale caret").
 *
 * Blink keeps the page's caret in a text field after focus leaves it, and
 * when the field is removed (a Home that opens the Juno chat, the palette
 * closing) it moves the caret to where the field was. Chromium then makes
 * that caret canonical before every frame (`WidgetBase::UpdateSelectionBounds`),
 * walking back through the DOM to the nearest editable position: about 4 ms
 * a frame past the sidebar's rows, which doubled All topics scroll work.
 * Script cannot see that caret (`getSelection().type` is `None`), and a caret
 * outside an editable is not drawn, so clearing it changes nothing on screen.
 * A text field keeps its own selection and gets it back when it is focused
 * again. Text the user selected (a `Range`) is never cleared.
 */
export function clearCaretsLeftBehind(): () => void {
  let frame: number | undefined
  const onFocusOut = (event: FocusEvent) => {
    if (!isTextField(event.target) || frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (isTextField(document.activeElement)) return
      const selection = document.getSelection()
      if (selection === null || selection.type === 'Range') return
      selection.removeAllRanges()
    })
  }
  document.addEventListener('focusout', onFocusOut)
  return () => {
    document.removeEventListener('focusout', onFocusOut)
    if (frame !== undefined) cancelAnimationFrame(frame)
  }
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || (target instanceof HTMLElement && target.isContentEditable)
}
