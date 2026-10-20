import type { CodeHighlighter } from '@juno/views'

/**
 * The app's code highlighter. This module is in the start bundle and stays
 * small: it waits for a block to come near the screen, then loads the
 * painter chunk (`painter.ts`), which starts the highlight worker.
 */

type Painter = typeof import('./painter')

/** Blocks start colouring this far before they scroll into view. */
const NEAR = '200px 0px'

let painter: Painter | undefined
let observer: IntersectionObserver | undefined
const waiting = new Map<Element, () => void>()

/** Calls `near` once when `element` comes within `NEAR` of the screen. Returns a function that stops waiting. */
function whenNearScreen(element: Element, near: () => void): () => void {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const call = waiting.get(entry.target)
        waiting.delete(entry.target)
        observer?.unobserve(entry.target)
        call?.()
      }
    },
    { rootMargin: NEAR },
  )
  waiting.set(element, near)
  observer.observe(element)
  return () => {
    if (waiting.delete(element)) observer?.unobserve(element)
  }
}

export const codeHighlighter: CodeHighlighter = {
  // Every block waits until it is near the screen, even one whose colours are
  // known: a topic that opens again does not paint its blocks off screen.
  paint(element, code, language) {
    let live = true
    let stop: (() => void) | undefined
    const unwatch = whenNearScreen(element, () => {
      if (painter !== undefined) {
        stop = painter.paint(element, code, language)
        return
      }
      void import('./painter').then((module) => {
        painter = module
        if (live) stop = module.paint(element, code, language)
      })
    })
    return () => {
      live = false
      unwatch()
      stop?.()
    }
  },
}
