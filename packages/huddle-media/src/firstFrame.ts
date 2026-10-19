/**
 * Whether a video element has a frame to show: once it has decoded one, and
 * no longer once its stream goes (`emptied`). Both sessions report a share's
 * `ready` from this. Calls `onChange` at once with the current answer, then
 * on every change, until the returned function is called.
 */
export function watchFirstFrame(element: HTMLVideoElement, onChange: (ready: boolean) => void): () => void {
  let last: boolean | undefined
  const check = () => {
    const ready = element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && element.videoWidth > 0
    if (ready === last) return
    last = ready
    onChange(ready)
  }
  const events = ['loadeddata', 'resize', 'emptied'] as const
  for (const type of events) element.addEventListener(type, check)
  check()
  return () => {
    for (const type of events) element.removeEventListener(type, check)
  }
}
