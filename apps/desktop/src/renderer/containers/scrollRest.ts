/** Defers an ambiguous scrollend until the position rests; a queued scroll at that same position is not movement. */
export function scrollRest(scroller: HTMLElement, delay: number) {
  let top: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(timer)
    top = undefined
  }
  return {
    pending: () => top !== undefined,
    onScroll: () => {
      if (top !== undefined && Math.abs(scroller.scrollTop - top) > 1) cancel()
    },
    defer: (rest: () => void) => {
      cancel()
      const stoppedAt = scroller.scrollTop
      top = stoppedAt
      timer = setTimeout(() => {
        cancel()
        if (Math.abs(scroller.scrollTop - stoppedAt) <= 1) rest()
      }, delay)
    },
    cancel,
  }
}
