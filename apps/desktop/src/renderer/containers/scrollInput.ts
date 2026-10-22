/**
 * Whether the user may be scrolling a list up: the wheel turned up, a touch moving or a key that scrolls up in the
 * last moment, or a press on the list still held (a scrollbar drag, a selection running past the edge), not one on a
 * control. A hold on the bottom lets go of a list that moved up only then. The list's own changes lower scrollTop
 * too, through scroll anchoring and with no input: a row dropped from the top of a full window as a message
 * arrives, a row above shrinking.
 */
const inputAt = new WeakMap<HTMLElement, number>()
const pressed = new WeakSet<HTMLElement>()
/** Input this recent, in milliseconds, may still be moving the list. */
const INPUT_IDLE = 100
const UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])
const CONTROLS = 'button, a, input, textarea, [role="toolbar"]'

export function scrollingUp(scroller: HTMLElement): boolean {
  return pressed.has(scroller) || performance.now() - (inputAt.get(scroller) ?? Number.NEGATIVE_INFINITY) < INPUT_IDLE
}

/** Records the user's input on `scroller` for `scrollingUp`. Returns the stop. */
export function watchUpwardInput(scroller: HTMLElement): () => void {
  const note = () => void inputAt.set(scroller, performance.now())
  const onWheel = (event: WheelEvent) => event.deltaY < 0 && note()
  const onKey = (event: KeyboardEvent) => (UP_KEYS.has(event.key) || (event.key === ' ' && event.shiftKey)) && note()
  // A press on a control opens a menu or acts, and a native menu can swallow its `pointerup`, so it is no scroll.
  const onPress = (event: PointerEvent) => {
    if (event.button === 0 && !(event.target instanceof Element && event.target.closest(CONTROLS) !== null)) pressed.add(scroller)
  }
  const onRelease = () => void pressed.delete(scroller)
  scroller.addEventListener('wheel', onWheel, { passive: true })
  scroller.addEventListener('touchmove', note, { passive: true })
  scroller.addEventListener('keydown', onKey, { passive: true })
  scroller.addEventListener('pointerdown', onPress, { passive: true })
  addEventListener('pointerup', onRelease, { passive: true })
  addEventListener('pointercancel', onRelease, { passive: true })
  addEventListener('blur', onRelease)
  return () => {
    scroller.removeEventListener('wheel', onWheel)
    scroller.removeEventListener('touchmove', note)
    scroller.removeEventListener('keydown', onKey)
    scroller.removeEventListener('pointerdown', onPress)
    removeEventListener('pointerup', onRelease)
    removeEventListener('pointercancel', onRelease)
    removeEventListener('blur', onRelease)
    onRelease()
  }
}
