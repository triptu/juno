/**
 * How a message's picture loads, and what happens when it does not
 * (docs/state-machines.md, "Message picture").
 *
 * A thumbnail that fails to load (the laptop asleep, Slack slow, the file
 * host answering an error) must not stay broken until the app restarts.
 * The picture is asked for again, each time by remounting its `<img>`, so
 * Chromium fetches the address afresh:
 *
 * - by itself, after 2 s, 8 s and 30 s, and then no more by itself;
 * - when the connection comes back (`online`);
 * - when the picture comes back into view after being out of it (scrolled
 *   away, or its tab hidden and shown again);
 * - when the user clicks the broken picture.
 *
 * Each of the last three is one more try, so a file that is really gone
 * costs a bounded number of requests and stays as "couldn't load" with a
 * way to try again. A `src` that changes (the staged copy giving way to
 * Slack's) starts over.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** The delays before a failed picture is asked for again by itself. */
export const PICTURE_RETRY_DELAYS_MS: ReadonlyArray<number> = [2_000, 8_000, 30_000]

export interface PictureLoad {
  /** The `src` last loaded in full: shown under a new one while it loads. */
  readonly shownSrc: string | undefined
  /** Whether `src` has failed and not loaded since: the broken glyph, over a retry in flight too. */
  readonly failed: boolean
  /** Changes with each try: the `<img>`'s key, so it remounts and fetches again. */
  readonly attempt: number
  readonly onLoad: () => void
  readonly onError: () => void
  /** One more try, now. */
  readonly retry: () => void
  /** Takes the picture's box, as a ref callback, for the return-to-view trigger. */
  readonly observe: (box: Element | null) => void
}

interface State {
  readonly src: string
  readonly shownSrc: string | undefined
  readonly failures: number
  readonly failed: boolean
  readonly attempt: number
}

export function usePictureLoad(src: string): PictureLoad {
  const [state, setState] = useState<State>({ src, shownSrc: undefined, failures: 0, failed: false, attempt: 0 })
  const current = state.src === src ? state : { ...state, src, failures: 0, failed: false, attempt: 0 }
  if (current !== state) setState(current)

  const retry = useCallback(() => {
    setState((s) => (s.failed ? { ...s, failed: false, attempt: s.attempt + 1 } : s))
  }, [])
  const onLoad = useCallback(() => {
    setState((s) => ({ ...s, shownSrc: s.src, failures: 0, failed: false }))
  }, [])
  // Set when the picture left view, or its effects were torn down (a hidden tab), while failed.
  const wasAway = useRef(false)
  const onError = useCallback(() => {
    wasAway.current = false
    setState((s) => ({ ...s, failed: true, failures: s.failures + 1 }))
  }, [])

  const { failed, failures } = current
  useEffect(() => {
    if (!failed) return
    const delay = PICTURE_RETRY_DELAYS_MS[failures - 1]
    const timer = delay === undefined ? undefined : setTimeout(retry, delay)
    window.addEventListener('online', retry)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      window.removeEventListener('online', retry)
      wasAway.current = true
    }
  }, [failed, failures, retry])

  const [box, setBox] = useState<Element | null>(null)
  useEffect(() => {
    if (!failed || box === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting)
      if (visible && wasAway.current) retry()
      else if (!visible) wasAway.current = true
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [failed, box, retry])

  return { shownSrc: current.shownSrc, failed, attempt: current.attempt, onLoad, onError, retry, observe: setBox }
}
