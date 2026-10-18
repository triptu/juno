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
 * again. Text the user selected (a `Range`) is never cleared, and while the
 * mouse button is down nothing is: a press on text that takes focus from a
 * field starts a drag selection from the caret it places, and clearing that
 * caret in the next frame left the drag selecting nothing. It is checked
 * again once the button is up.
 */
export function clearCaretsLeftBehind(): () => void {
  let frame: number | undefined
  // A press that moves focus out of a field may be starting a drag selection, whose caret is its anchor; it is checked on release.
  let pressed = false
  let waiting = false
  const clear = () => {
    frame = undefined
    if (pressed) return void (waiting = true)
    if (isTextField(document.activeElement)) return
    const selection = document.getSelection()
    if (selection === null || selection.type === 'Range') return
    selection.removeAllRanges()
  }
  const onFocusOut = (event: FocusEvent) => {
    if (!isTextField(event.target) || frame !== undefined) return
    frame = requestAnimationFrame(clear)
  }
  const onPointerDown = (event: PointerEvent) => {
    if (event.button === 0) pressed = true
  }
  const onPointerUp = () => {
    pressed = false
    if (!waiting) return
    waiting = false
    frame ??= requestAnimationFrame(clear)
  }
  document.addEventListener('focusout', onFocusOut)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointerup', onPointerUp, true)
  document.addEventListener('pointercancel', onPointerUp, true)
  return () => {
    document.removeEventListener('focusout', onFocusOut)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('pointercancel', onPointerUp, true)
    if (frame !== undefined) cancelAnimationFrame(frame)
  }
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || (target instanceof HTMLElement && target.isContentEditable)
}
