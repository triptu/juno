/**
 * Whether the user may be scrolling a list up: the wheel turned up, a touch moving or a key that scrolls up in the
 * last moment, or a held press moving upward (a scrollbar drag, a selection running past the edge), not one on a
 * control. A hold on the bottom lets go of a list that moved up only then. The list's own changes lower scrollTop
 * too, through scroll anchoring and with no input: a row dropped from the top of a full window as a message
 * arrives, a row above shrinking.
 */
const inputAt = new WeakMap<HTMLElement, number>()
const pressed = new WeakMap<HTMLElement, { y: number; up: boolean }>()
/** Input this recent, in milliseconds, may still be moving the list. */
const INPUT_IDLE = 100
const UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])
const CONTROLS = 'button, a, input, textarea, [role="toolbar"]'

export function scrollingUp(scroller: HTMLElement): boolean {
  return pressed.get(scroller)?.up === true || performance.now() - (inputAt.get(scroller) ?? Number.NEGATIVE_INFINITY) < INPUT_IDLE
}

/** Records the user's input on `scroller` for `scrollingUp`. Returns the stop. */
export function watchUpwardInput(scroller: HTMLElement): () => void {
  const note = () => void inputAt.set(scroller, performance.now())
  const onWheel = (event: WheelEvent) => event.deltaY < 0 && note()
  const onKey = (event: KeyboardEvent) => (UP_KEYS.has(event.key) || (event.key === ' ' && event.shiftKey)) && note()
  // A press on a control opens a menu or acts, and a native menu can swallow its `pointerup`, so it is no scroll.
  const onPress = (event: PointerEvent) => {
    if (event.button === 0 && !(event.target instanceof Element && event.target.closest(CONTROLS) !== null)) pressed.set(scroller, { y: event.clientY, up: false })
  }
  const onMove = (event: PointerEvent) => {
    const press = pressed.get(scroller)
    if (press === undefined || event.clientY === press.y) return
    press.up = event.clientY < press.y
    press.y = event.clientY
  }
  const onRelease = () => void pressed.delete(scroller)
  scroller.addEventListener('wheel', onWheel, { passive: true })
  scroller.addEventListener('touchmove', note, { passive: true })
  scroller.addEventListener('keydown', onKey, { passive: true })
  scroller.addEventListener('pointerdown', onPress, { passive: true })
  addEventListener('pointermove', onMove, { passive: true })
  addEventListener('pointerup', onRelease, { passive: true })
  addEventListener('pointercancel', onRelease, { passive: true })
  addEventListener('blur', onRelease)
  return () => {
    scroller.removeEventListener('wheel', onWheel)
    scroller.removeEventListener('touchmove', note)
    scroller.removeEventListener('keydown', onKey)
    scroller.removeEventListener('pointerdown', onPress)
    removeEventListener('pointermove', onMove)
    removeEventListener('pointerup', onRelease)
    removeEventListener('pointercancel', onRelease)
    removeEventListener('blur', onRelease)
    onRelease()
  }
}
